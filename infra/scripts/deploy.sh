#!/usr/bin/env bash
# Deploy the entire project to the remote server.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] || { echo "missing .env (copy from .env.example)" >&2; exit 1; }
set -a; source "$PROJECT_DIR/.env"; set +a
: "${REMOTE_USER:?}"; : "${REMOTE_HOST:?}"; : "${REMOTE_DIR:?}"; : "${WEB_PORT:?}"

echo "=== Step 1: rsync project to remote ==="
ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "mkdir -p $REMOTE_DIR"
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.env' \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='*.log' \
  "$PROJECT_DIR/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"

echo "=== Step 2: Run migrations ==="
bash "$SCRIPT_DIR/migrate.sh"

echo "=== Step 3: Build web frontend ==="
bash "$SCRIPT_DIR/ssh.sh" "cd $REMOTE_DIR/web && npm install --legacy-peer-deps && npm run build"

echo "=== Step 4: Render + import n8n credentials and workflows (envsubst from .env) ==="
TMP=$(mktemp -d); trap "rm -rf $TMP" EXIT
mkdir -p "$TMP/credentials"
mkdir -p "$TMP/workflows"
for f in "$PROJECT_DIR"/infra/n8n/credentials/*.json; do
  envsubst < "$f" > "$TMP/credentials/$(basename "$f")"
done
for f in "$PROJECT_DIR"/infra/n8n/workflows/*.json; do
  envsubst < "$f" > "$TMP/workflows/$(basename "$f")"
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
"

echo "=== Step 5: Deploy launchd plists (renders templates from .env) ==="
bash "$SCRIPT_DIR/deploy-launchd.sh"

echo "=== Done! Open http://${REMOTE_HOST}:${WEB_PORT} ==="
