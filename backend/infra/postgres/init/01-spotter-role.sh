#!/bin/sh
set -eu

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$SPOTTER_APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE spotter_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spotter_app') \gexec

ALTER DATABASE spotter OWNER TO spotter_app;
GRANT CONNECT ON DATABASE spotter TO spotter_app;
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
SQL
