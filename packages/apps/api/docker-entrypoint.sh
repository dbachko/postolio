#!/bin/sh
set -e

# Basic environment diagnostics (non-sensitive)
echo "Starting container with environment:"
echo "NODE_ENV: ${NODE_ENV}"
echo "PORT: ${PORT}"
echo "DB_HOST is set: $([ -n "$DB_HOST" ] && echo "yes" || echo "no")"
echo "DB_USERNAME is set: $([ -n "$DB_USERNAME" ] && echo "yes" || echo "no")"
echo "DB_PASSWORD is set: $([ -n "$DB_PASSWORD" ] && echo "yes" || echo "no")"
echo "JWT_SECRET is set: $([ -n "$JWT_SECRET" ] && echo "yes" || echo "no")"

# SSL defaults:
# - keep strict TLS verification by default
# - use AWS RDS global CA bundle when available
# - allow explicit override via DB_SSLMODE / DB_SSLROOTCERT
DB_SSLMODE="${DB_SSLMODE:-require}"
if [ -z "${DB_SSLROOTCERT:-}" ]; then
  if [ -f "/etc/ssl/certs/rds-global-bundle.pem" ]; then
    DB_SSLROOTCERT="/etc/ssl/certs/rds-global-bundle.pem"
  else
    DB_SSLROOTCERT="/etc/ssl/certs/ca-certificates.crt"
  fi
fi
SSL_QUERY="sslmode=${DB_SSLMODE}"
if [ -f "${DB_SSLROOTCERT}" ]; then
  SSL_QUERY="${SSL_QUERY}&sslrootcert=${DB_SSLROOTCERT}"
  if [ -z "${NODE_EXTRA_CA_CERTS:-}" ]; then
    export NODE_EXTRA_CA_CERTS="${DB_SSLROOTCERT}"
  fi
else
  echo "DB_SSLROOTCERT file not found at ${DB_SSLROOTCERT}; continuing without sslrootcert"
fi
echo "DB_SSLMODE: ${DB_SSLMODE}"
echo "DB_SSLROOTCERT: ${DB_SSLROOTCERT}"
echo "NODE_EXTRA_CA_CERTS is set: $([ -n "$NODE_EXTRA_CA_CERTS" ] && echo "yes" || echo "no")"

# Construct DATABASE_URL from individual parts if provided
if [ -n "$DB_USERNAME" ] && [ -n "$DB_PASSWORD" ] && [ -n "$DB_HOST" ] && [ -n "$DB_PORT" ]; then
  # Enforce TLS with selected mode and optional explicit root cert bundle
  export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postolio?${SSL_QUERY}"
  echo "DATABASE_URL constructed successfully"
elif [ -n "$DB_USERNAME" ] && [ -n "$DB_PASSWORD" ] && [ -n "$DB_HOST" ]; then
  export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:5432/postolio?${SSL_QUERY}"
  echo "DATABASE_URL constructed with default port"
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL could not be constructed and is not provided"
  echo "Required environment variables: DB_USERNAME, DB_PASSWORD, DB_HOST [DB_PORT] or DATABASE_URL"
  exit 1
fi

echo "DATABASE_URL is configured"

# Run Prisma migrations (idempotent) from the database package
echo "Running database migrations..."
cd /app/packages/libs/database
PRISMA_BIN="./node_modules/.bin/prisma"
if [ ! -x "$PRISMA_BIN" ]; then
  echo "ERROR: Prisma CLI not found at $PRISMA_BIN"
  exit 1
fi
echo "Using Prisma CLI from workspace package"

# Failed migrations need a human: a parallel replica's in-progress migration looks failed too,
# so never auto-resolve here. migrate deploy holds a Postgres advisory lock across replicas.
# Apply all migrations for main DB (idempotent).
# On failure, exit hard. Never reset database state in deploy/runtime paths.
if ! "$PRISMA_BIN" migrate deploy; then
  echo "migrate deploy failed"
  echo "Refusing any database reset in deploy path. Exiting with failure."
  exit 1
fi

# Return to API app directory
cd /app/packages/apps/api

# Sync curated recipe catalog so new/updated/retired curated recipes are
# consistently rolled out for all brands during deploy/startup.
if [ "${SKIP_CURATED_RECIPES_SYNC:-}" = "1" ]; then
  echo "Skipping curated recipe sync (SKIP_CURATED_RECIPES_SYNC=1)"
else
  echo "Syncing curated recipes catalog..."
  node dist/scripts/sync-curated-recipes.js
fi

# Execute main command (CMD)
exec "$@"
