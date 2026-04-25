#!/usr/bin/env bash
# Apply all .sql files in infra/postgres/migrations/ in order against the remote news db.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] || { echo "missing .env" >&2; exit 1; }
set -a; source "$PROJECT_DIR/.env"; set +a
: "${REMOTE_USER:?}"; : "${REMOTE_HOST:?}"; : "${REMOTE_DIR:?}"
DBNAME="${PGDATABASE:?}"
DBUSER="${PGUSER:?}"

ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "mkdir -p $REMOTE_DIR/infra/postgres/migrations"
rsync -az --delete "$PROJECT_DIR/infra/postgres/migrations/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/postgres/migrations/"

for f in "$PROJECT_DIR/infra/postgres/migrations"/*.sql; do
  name=$(basename "$f")
  echo "Applying $name..."
  bash "$SCRIPT_DIR/ssh.sh" "psql -U $DBUSER -d $DBNAME -v ON_ERROR_STOP=1 -f $REMOTE_DIR/infra/postgres/migrations/$name"
done
echo "Done."
