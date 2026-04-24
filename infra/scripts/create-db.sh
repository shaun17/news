#!/usr/bin/env bash
# Creates the `news` database on the remote Mac mini via SSH if missing.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] && source "$PROJECT_DIR/.env"
DBNAME="${PGDATABASE:-news}"
DBUSER="${PGUSER:-coco}"

EXISTS=$(bash "$SCRIPT_DIR/ssh.sh" "psql -U $DBUSER -d postgres -tAc \"SELECT 1 FROM pg_database WHERE datname='$DBNAME'\"" | tr -d '[:space:]')

if [ "$EXISTS" = "1" ]; then
  echo "Database '$DBNAME' already exists."
else
  bash "$SCRIPT_DIR/ssh.sh" "psql -U $DBUSER -d postgres -c \"CREATE DATABASE $DBNAME OWNER $DBUSER;\""
  echo "Created database '$DBNAME'."
fi
