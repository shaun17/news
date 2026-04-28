#!/usr/bin/env bash
# Deploy the entire project to the remote server.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] || { echo "missing .env (copy from .env.example)" >&2; exit 1; }
set -a; source "$PROJECT_DIR/.env"; set +a
: "${REMOTE_USER:?}"; : "${REMOTE_HOST:?}"; : "${REMOTE_DIR:?}"; : "${WEB_PORT:?}"
: "${MOONSHOT_API_KEY:?}"; : "${MOONSHOT_API_URL:?}"; : "${MOONSHOT_MODEL:?}"
: "${NEWS_API_SECRET:?}"

echo "=== Step 1: rsync project to remote ==="
ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "mkdir -p $REMOTE_DIR"
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.env' \
  --exclude='.git' \
  --exclude='.claude' \
  --exclude='.superpowers' \
  --exclude='.DS_Store' \
  --exclude='*.log' \
  "$PROJECT_DIR/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"

echo "=== Step 2: Run migrations ==="
bash "$SCRIPT_DIR/migrate.sh"

echo "=== Step 3: Build web frontend ==="
# next/font 在 build 时会从 Google Fonts 拉字体；远程机出网必须走 MBP 代理。
bash "$SCRIPT_DIR/ssh.sh" "cd $REMOTE_DIR/web && HTTPS_PROXY='$MBP_PROXY' HTTP_PROXY='$MBP_PROXY' npm install --legacy-peer-deps && HTTPS_PROXY='$MBP_PROXY' HTTP_PROXY='$MBP_PROXY' npm run build"

echo "=== Step 4: Render + import n8n credentials and workflows (envsubst from .env) ==="
TMP=$(mktemp -d); trap "rm -rf $TMP" EXIT
mkdir -p "$TMP/credentials"
mkdir -p "$TMP/workflows"

# 只替换项目级占位符，保留 n8n 表达式里的 $json / $input 等运行时变量。
N8N_ENV_SUBST='${MBP_PROXY} ${WEB_PORT} ${NEWS_API_SECRET} ${MOONSHOT_API_KEY} ${MOONSHOT_API_URL} ${MOONSHOT_MODEL} ${PGHOST} ${PGPORT} ${PGDATABASE} ${PGUSER} ${PGPASSWORD} ${PGSSL}'
for f in "$PROJECT_DIR"/infra/n8n/credentials/*.json; do
  envsubst "$N8N_ENV_SUBST" < "$f" > "$TMP/credentials/$(basename "$f")"
done
for f in "$PROJECT_DIR"/infra/n8n/workflows/*.json; do
  envsubst "$N8N_ENV_SUBST" < "$f" > "$TMP/workflows/$(basename "$f")"
done
ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "rm -rf /tmp/news-credentials && mkdir -p /tmp/news-credentials"
ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "rm -rf /tmp/news-workflows && mkdir -p /tmp/news-workflows"
rsync -az "$TMP/credentials/" "$REMOTE_USER@$REMOTE_HOST:/tmp/news-credentials/"
rsync -az "$TMP/workflows/" "$REMOTE_USER@$REMOTE_HOST:/tmp/news-workflows/"
bash "$SCRIPT_DIR/ssh.sh" "
  for f in /tmp/news-credentials/*.json; do
    echo \"Importing credential \$(basename \$f)...\" && n8n import:credentials --input=\"\$f\" 2>&1 | tail -1
  done
  for f in /tmp/news-workflows/*.json; do
    echo \"Importing workflow \$(basename \$f)...\" && n8n import:workflow --input=\"\$f\" 2>&1 | tail -1
  done
  # n8n 导入会先取消激活；只 publish 仓库里显式 active=true 的 workflow。
  for f in /tmp/news-workflows/*.json; do
    node - \"\$f\" <<'NODE' | while IFS=\$'\t' read -r id name; do
const workflow = require(process.argv[2]);
if (workflow.active === true) {
  console.log(workflow.id + '\t' + workflow.name);
}
NODE
      [ -n \"\$id\" ] || continue
      n8n publish:workflow --id=\"\$id\" >/dev/null
      echo \"Published workflow \$name\"
    done
  done
"
ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"

# n8n 2.17 的 CLI 会把明文 data 对象导成 "[object Object]"；这里用当前实例的 encryptionKey 重新写入。
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const home = process.env.HOME;
const config = JSON.parse(fs.readFileSync(path.join(home, '.n8n/config'), 'utf8'));
const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const { Cipher } = require(path.join(globalRoot, 'n8n/node_modules/n8n-core'));
const cipher = new Cipher({ encryptionKey: config.encryptionKey });
const dbPath = path.join(home, '.n8n/database.sqlite');

// 转义 sqlite 文本值，避免 credential 名称、密文或类型里的单引号破坏 SQL。
const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

// credential 明文只存在 /tmp 渲染目录；入库前用 n8n 当前实例密钥加密。
for (const file of fs.readdirSync('/tmp/news-credentials')) {
  if (!file.endsWith('.json')) continue;

  const credentials = JSON.parse(fs.readFileSync(path.join('/tmp/news-credentials', file), 'utf8'));
  for (const credential of credentials) {
    if (!credential?.id || !credential?.name || !credential?.type) {
      throw new Error(`Invalid credential in ${file}`);
    }

    const encryptedData = cipher.encrypt(credential.data || {});
    const sql = `
      INSERT INTO credentials_entity (id, name, data, type, createdAt, updatedAt)
      VALUES (
        ${sqlString(credential.id)},
        ${sqlString(credential.name)},
        ${sqlString(encryptedData)},
        ${sqlString(credential.type)},
        STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'),
        STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        data = excluded.data,
        type = excluded.type,
        updatedAt = STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW');
    `;
    execFileSync('sqlite3', [dbPath, sql]);
    console.log(`Credential ready: ${credential.name}`);
  }
}
NODE
REMOTE

echo "=== Step 5: Deploy launchd plists (renders templates from .env) ==="
bash "$SCRIPT_DIR/deploy-launchd.sh"

echo "=== Step 6: Restart n8n (loads published workflows) ==="
ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
N8N_BIN="$HOME/.nvm/versions/node/v22.22.2/bin/n8n"
N8N_LOG="$HOME/Library/Logs/news-n8n.log"

# workflow 导入和 publish 由 CLI 完成；重启 n8n 让运行中进程加载最新 active workflow。
pids=$(ps -axo pid,command | awk '/node .*\/bin\/n8n start/ && !/awk/ {print $1}')
if [ -n "${pids:-}" ]; then
  kill $pids
fi

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ! /usr/bin/nc -z 127.0.0.1 5679 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

nohup "$N8N_BIN" start > "$N8N_LOG" 2>&1 &

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if /usr/bin/nc -z 127.0.0.1 5678 >/dev/null 2>&1; then
    echo "  ok: n8n"
    exit 0
  fi
  sleep 1
done

echo "  ! n8n did not open port 5678" >&2
tail -80 "$N8N_LOG" >&2 || true
exit 1
REMOTE

echo "=== Done! Open http://${REMOTE_HOST}:${WEB_PORT} ==="
