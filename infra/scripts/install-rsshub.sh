#!/usr/bin/env bash
# Install RSSHub on the remote (idempotent).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] || { echo "missing .env" >&2; exit 1; }
set -a; source "$PROJECT_DIR/.env"; set +a
: "${REMOTE_USER:?}"; : "${REMOTE_HOST:?}"

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
