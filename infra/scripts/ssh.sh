#!/usr/bin/env bash
# Run a command on the remote with login shell PATH (brew + nvm available).
# Usage: bash infra/scripts/ssh.sh '<command>'
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && source "$SCRIPT_DIR/.env"
REMOTE_USER="${REMOTE_USER:-coco}"
REMOTE_HOST="${REMOTE_HOST:-100.104.136.117}"
ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "source ~/.zshrc 2>/dev/null; export PATH=\$HOME/.nvm/versions/node/v22.22.2/bin:\$PATH; $1"
