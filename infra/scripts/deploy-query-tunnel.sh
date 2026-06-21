#!/usr/bin/env bash
# 在 mini 上把 query service 暴露到 Cloudflare Tunnel。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] || { echo "missing .env (copy from .env.example)" >&2; exit 1; }
set -a; source "$PROJECT_DIR/.env"; set +a

: "${REMOTE_USER:?}"; : "${REMOTE_HOST:?}"; : "${QUERY_API_BASE:?}"; : "${QUERY_SERVICE_PORT:?}"

# 从公开 URL 中取出 hostname，cloudflared ingress 只需要域名。
QUERY_API_HOST="${QUERY_API_BASE#*://}"
QUERY_API_HOST="${QUERY_API_HOST%%/*}"
QUERY_API_HOST="${QUERY_API_HOST%%:*}"
: "${QUERY_API_HOST:?}"

ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "QUERY_API_HOST='$QUERY_API_HOST' QUERY_SERVICE_PORT='$QUERY_SERVICE_PORT' bash -s" <<'REMOTE'
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
CONFIG="$HOME/.cloudflared/config.yml"
[ -f "$CONFIG" ] || { echo "missing cloudflared config: $CONFIG" >&2; exit 1; }

# 更新 ingress：保留现有域名，只把 query service 插到 404 fallback 前面。
node <<'NODE'
const fs = require('node:fs');
const configPath = `${process.env.HOME}/.cloudflared/config.yml`;
const host = process.env.QUERY_API_HOST;
const port = process.env.QUERY_SERVICE_PORT;
const block = `  - hostname: ${host}\n    service: http://127.0.0.1:${port}\n`;
const current = fs.readFileSync(configPath, 'utf8');

let next = current;
const hostPattern = new RegExp(`  - hostname: ${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n    service: http://127\\.0\\.0\\.1:\\d+\\n`, 'm');

if (hostPattern.test(next)) {
  next = next.replace(hostPattern, block);
} else {
  next = next.replace(/\n  - service: http_status:404\n?$/, `\n${block}\n  - service: http_status:404\n`);
}

if (next === current) {
  throw new Error('cloudflared config format did not match expected ingress fallback');
}

fs.writeFileSync(configPath, next);
NODE

# DNS route 已存在时 cloudflared 会返回非 0；这里不让幂等部署因此失败。
cloudflared tunnel route dns 8cbcc4d8-747a-4748-b52c-bac1d2a1c4a7 "$QUERY_API_HOST" >/tmp/news-query-tunnel-dns.log 2>&1 || true

launchctl kickstart -k "gui/$UID/com.cloudflare.cloudflared.news-n8n"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:${QUERY_SERVICE_PORT}/health" >/dev/null; then
    echo "  ok: query tunnel config for $QUERY_API_HOST"
    exit 0
  fi
  sleep 1
done

echo "  ! query service health check failed after tunnel deploy" >&2
exit 1
REMOTE
