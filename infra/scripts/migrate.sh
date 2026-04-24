#!/usr/bin/env bash
# Apply all .sql files in infra/postgres/migrations/ in order against the remote news db.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] && source "$PROJECT_DIR/.env"
REMOTE_USER="${REMOTE_USER:-coco}"
REMOTE_HOST="${REMOTE_HOST:-100.104.136.117}"
REMOTE_DIR="${REMOTE_DIR:-/Users/coco/code/news}"
DBNAME="${PGDATABASE:-news}"
DBUSER="${PGUSER:-coco}"

ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "mkdir -p $REMOTE_DIR/infra/postgres/migrations"
rsync -az --delete "$PROJECT_DIR/infra/postgres/migrations/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/postgres/migrations/"

for f in "$PROJECT_DIR/infra/postgres/migrations"/*.sql; do
  name=$(basename "$f")
  echo "Applying $name..."
  bash "$SCRIPT_DIR/ssh.sh" "psql -U $DBUSER -d $DBNAME -v ON_ERROR_STOP=1 -f $REMOTE_DIR/infra/postgres/migrations/$name"
done
echo "Done."
