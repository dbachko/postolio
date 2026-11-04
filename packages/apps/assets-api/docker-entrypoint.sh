#!/bin/sh
set -e

# Basic environment diagnostics (non-sensitive)
echo "Starting assets container with environment:"
echo "NODE_ENV: ${NODE_ENV}"
echo "PORT: ${PORT}"
echo "ASSETS_DB_HOST is set: $([ -n "$ASSETS_DB_HOST" ] && echo "yes" || echo "no")"
echo "ASSETS_DB_USERNAME is set: $([ -n "$ASSETS_DB_USERNAME" ] && echo "yes" || echo "no")"
echo "ASSETS_DB_PASSWORD is set: $([ -n "$ASSETS_DB_PASSWORD" ] && echo "yes" || echo "no")"
echo "JWT_SECRET is set: $([ -n "$JWT_SECRET" ] && echo "yes" || echo "no")"

# SSL defaults:
# - keep strict TLS verification by default
# - use AWS RDS global CA bundle when available
# - allow explicit override via ASSETS_DB_SSLMODE / ASSETS_DB_SSLROOTCERT
ASSETS_DB_SSLMODE="${ASSETS_DB_SSLMODE:-require}"
if [ -z "${ASSETS_DB_SSLROOTCERT:-}" ]; then
  if [ -f "/etc/ssl/certs/rds-global-bundle.pem" ]; then
    ASSETS_DB_SSLROOTCERT="/etc/ssl/certs/rds-global-bundle.pem"
  else
    ASSETS_DB_SSLROOTCERT="/etc/ssl/certs/ca-certificates.crt"
  fi
fi
SSL_QUERY="sslmode=${ASSETS_DB_SSLMODE}"
if [ -f "${ASSETS_DB_SSLROOTCERT}" ]; then
  SSL_QUERY="${SSL_QUERY}&sslrootcert=${ASSETS_DB_SSLROOTCERT}"
  if [ -z "${NODE_EXTRA_CA_CERTS:-}" ]; then
    export NODE_EXTRA_CA_CERTS="${ASSETS_DB_SSLROOTCERT}"
  fi
else
  echo "ASSETS_DB_SSLROOTCERT file not found at ${ASSETS_DB_SSLROOTCERT}; continuing without sslrootcert"
fi
echo "ASSETS_DB_SSLMODE: ${ASSETS_DB_SSLMODE}"
echo "ASSETS_DB_SSLROOTCERT: ${ASSETS_DB_SSLROOTCERT}"
echo "NODE_EXTRA_CA_CERTS is set: $([ -n "$NODE_EXTRA_CA_CERTS" ] && echo "yes" || echo "no")"

# Construct ASSETS_DATABASE_URL from individual parts if provided
if [ -n "$ASSETS_DB_USERNAME" ] && [ -n "$ASSETS_DB_PASSWORD" ] && [ -n "$ASSETS_DB_HOST" ] && [ -n "$ASSETS_DB_PORT" ]; then
  # Enforce TLS with selected mode and optional explicit root cert bundle
  export ASSETS_DATABASE_URL="postgresql://${ASSETS_DB_USERNAME}:${ASSETS_DB_PASSWORD}@${ASSETS_DB_HOST}:${ASSETS_DB_PORT}/postolio_assets?${SSL_QUERY}"
  echo "ASSETS_DATABASE_URL constructed successfully"
elif [ -n "$ASSETS_DB_USERNAME" ] && [ -n "$ASSETS_DB_PASSWORD" ] && [ -n "$ASSETS_DB_HOST" ]; then
  export ASSETS_DATABASE_URL="postgresql://${ASSETS_DB_USERNAME}:${ASSETS_DB_PASSWORD}@${ASSETS_DB_HOST}:5432/postolio_assets?${SSL_QUERY}"
  echo "ASSETS_DATABASE_URL constructed with default port"
fi

if [ -z "$ASSETS_DATABASE_URL" ]; then
  echo "ERROR: ASSETS_DATABASE_URL could not be constructed and is not provided"
  echo "Required environment variables: ASSETS_DB_USERNAME, ASSETS_DB_PASSWORD, ASSETS_DB_HOST [ASSETS_DB_PORT] or ASSETS_DATABASE_URL"
  exit 1
fi

echo "ASSETS_DATABASE_URL is configured"

# Run migrations (idempotent) from the database-assets package. The client is generated at build time.
echo "Running database migrations..."
cd /app/packages/libs/database-assets

PRISMA_BIN="./node_modules/.bin/prisma"
if [ ! -x "$PRISMA_BIN" ]; then
  echo "ERROR: Prisma CLI not found at $PRISMA_BIN"
  exit 1
fi

# Failed migrations need a human: a parallel replica's in-progress migration looks failed too,
# so never auto-resolve here. migrate deploy holds a Postgres advisory lock across replicas.
if ! "$PRISMA_BIN" migrate deploy; then
  echo "migrate deploy failed; refusing to start"
  exit 1
fi
echo "Migrations completed"

# Return to assets app directory
cd /app/packages/apps/assets-api

# Execute main command (CMD)
exec "$@"
