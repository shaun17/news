#!/usr/bin/env bash
# Creates the `news` database on the remote Mac mini via SSH if missing.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] || { echo "missing .env" >&2; exit 1; }
set -a; source "$PROJECT_DIR/.env"; set +a
DBNAME="${PGDATABASE:?}"
DBUSER="${PGUSER:?}"

EXISTS=$(bash "$SCRIPT_DIR/ssh.sh" "psql -U $DBUSER -d postgres -tAc \"SELECT 1 FROM pg_database WHERE datname='$DBNAME'\"" | tr -d '[:space:]')

if [ "$EXISTS" = "1" ]; then
  echo "Database '$DBNAME' already exists."
else
  bash "$SCRIPT_DIR/ssh.sh" "psql -U $DBUSER -d postgres -c \"CREATE DATABASE $DBNAME OWNER $DBUSER;\""
  echo "Created database '$DBNAME'."
fi
