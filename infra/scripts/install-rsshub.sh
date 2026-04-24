#!/usr/bin/env bash
# Install RSSHub on the remote (idempotent).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] && source "$PROJECT_DIR/.env"
REMOTE_USER="${REMOTE_USER:-coco}"
REMOTE_HOST="${REMOTE_HOST:-100.104.136.117}"

bash "$SCRIPT_DIR/ssh.sh" '
  set -e
  if [ ! -d ~/code/rsshub ]; then
    git clone --depth=1 https://github.com/DIYgod/RSSHub.git ~/code/rsshub
  fi
  cd ~/code/rsshub
  npm install --legacy-peer-deps
  npm run build
'
echo "RSSHub installed at ~/code/rsshub on remote."
