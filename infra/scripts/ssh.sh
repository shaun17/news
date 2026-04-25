#!/usr/bin/env bash
# Run a command on the remote with login shell PATH (brew + nvm available).
# Usage: bash infra/scripts/ssh.sh '<command>'
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$SCRIPT_DIR/.env" ] || { echo "missing .env (copy from .env.example)" >&2; exit 1; }
set -a; source "$SCRIPT_DIR/.env"; set +a
: "${REMOTE_USER:?REMOTE_USER not set in .env}"
: "${REMOTE_HOST:?REMOTE_HOST not set in .env}"
ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "source ~/.zshrc 2>/dev/null; export PATH=\$HOME/.nvm/versions/node/v22.22.2/bin:\$PATH; $1"
