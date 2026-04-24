#!/usr/bin/env bash
# Deploy the entire project to the remote server.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] && source "$PROJECT_DIR/.env"
REMOTE_USER="${REMOTE_USER:-coco}"
REMOTE_HOST="${REMOTE_HOST:-100.104.136.117}"
REMOTE_DIR="${REMOTE_DIR:-/Users/coco/code/news}"

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

echo "=== Step 4: Import n8n workflows ==="
bash "$SCRIPT_DIR/ssh.sh" "
  cd $REMOTE_DIR
  for f in infra/n8n/workflows/*.json; do
    [ \"\$f\" = 'infra/n8n/workflows/.gitkeep' ] && continue
    echo \"Importing \$f...\" && n8n import:workflow --input=\"\$f\" 2>&1 | head -1
  done
"

echo "=== Step 5: Deploy launchd plists ==="
bash "$SCRIPT_DIR/ssh.sh" "
  cp $REMOTE_DIR/infra/launchd/com.news.web.plist ~/Library/LaunchAgents/
  launchctl unload ~/Library/LaunchAgents/com.news.web.plist 2>/dev/null || true
  launchctl load -w ~/Library/LaunchAgents/com.news.web.plist
  echo 'Web launchd loaded.'
"

echo "=== Done! Open http://100.104.136.117:3000 ==="
