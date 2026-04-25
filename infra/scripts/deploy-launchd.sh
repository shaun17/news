#!/usr/bin/env bash
# Render plist templates with .env values + push to remote ~/Library/LaunchAgents
# and (re)bootstrap each one.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] || { echo "missing .env (copy from .env.example and fill secrets)" >&2; exit 1; }
set -a; source "$PROJECT_DIR/.env"; set +a

: "${REMOTE_USER:?}"; : "${REMOTE_HOST:?}"

# Required vars referenced in any plist template
required=(REMOTE_USER_HOME REMOTE_DIR MBP_PROXY RSSHUB_PORT WEB_PORT N8N_WEBHOOK_BASE
          TWITTER_AUTH_TOKEN MOONSHOT_API_KEY MOONSHOT_MODEL MOONSHOT_API_URL
          PGUSER PGDATABASE PGHOST PGPORT PGSSL)
for v in "${required[@]}"; do
  if [ -z "${!v:-}" ]; then echo "  ! \$$v is empty in .env" >&2; exit 1; fi
done

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
for src in "$PROJECT_DIR"/infra/launchd/com.news.*.plist; do
  base=$(basename "$src")
  envsubst < "$src" > "$TMP/$base"
done

# Push rendered plists, then bootout/bootstrap on remote
ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "mkdir -p ~/Library/LaunchAgents"
rsync -az "$TMP/" "$REMOTE_USER@$REMOTE_HOST:~/Library/LaunchAgents/" --include='com.news.*.plist' --exclude='*'

ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" 'set -e
  for p in ~/Library/LaunchAgents/com.news.*.plist; do
    label=$(basename "$p" .plist)
    launchctl bootout gui/$UID/"$label" 2>/dev/null || true
    launchctl bootstrap gui/$UID "$p"
    echo "  ok: $label"
  done
'
echo "deploy-launchd done."
