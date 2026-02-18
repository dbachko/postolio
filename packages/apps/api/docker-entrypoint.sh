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

# Check for failed migrations and resolve them by marking as rolled back (so deploy will re-apply)
echo "Checking for failed migrations..."
FAILED=$(prisma migrate status 2>&1 | grep -Eo '[0-9]{14}_[A-Za-z0-9_]+' | sort -u || true)
if [ -n "$FAILED" ]; then
  echo "Found failed migrations: $FAILED"
  for MID in $FAILED; do
    echo "Resolving failed migration as rolled-back: $MID"
    prisma migrate resolve --rolled-back "$MID" || true
  done
fi

# Apply all migrations for main DB (idempotent).
# If migrate deploy fails, NEVER auto-reset in shared environments.
# Allow an explicit opt-in reset only when MIGRATE_RESET_ON_FAILURE=true.
if ! prisma migrate deploy; then
  echo "migrate deploy failed"
  if [ "${MIGRATE_RESET_ON_FAILURE:-}" = "true" ]; then
    echo "MIGRATE_RESET_ON_FAILURE=true - attempting clean reset ..."
    prisma migrate reset --force || true
    prisma migrate deploy
  else
    echo "Automatic prisma migrate reset is disabled. Exiting with failure."
    exit 1
  fi
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
