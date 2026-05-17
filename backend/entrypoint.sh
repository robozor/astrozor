#!/usr/bin/env bash
# Astrozor backend container entrypoint.
# Waits for DB, applies migrations, then execs the given command.

set -euo pipefail

echo "[entrypoint] waiting for database at ${POSTGRES_HOST:-db}:${POSTGRES_PORT:-5432}..."
ATTEMPTS=0
MAX_ATTEMPTS=60
until python -c "
import os, psycopg
psycopg.connect(
    host=os.environ.get('POSTGRES_HOST','db'),
    port=int(os.environ.get('POSTGRES_PORT','5432')),
    user=os.environ.get('POSTGRES_USER','astrozor'),
    password=os.environ.get('POSTGRES_PASSWORD','astrozor'),
    dbname=os.environ.get('POSTGRES_DB','astrozor'),
).close()
" 2>/dev/null; do
    ATTEMPTS=$((ATTEMPTS+1))
    if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
        echo "[entrypoint] database not reachable after ${MAX_ATTEMPTS} attempts, exiting" >&2
        exit 1
    fi
    sleep 1
done
echo "[entrypoint] database reachable."

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
    echo "[entrypoint] applying migrations..."
    python manage.py migrate --noinput
fi

if [ "${COLLECTSTATIC:-0}" = "1" ]; then
    python manage.py collectstatic --noinput
fi

echo "[entrypoint] launching: $*"
exec "$@"
