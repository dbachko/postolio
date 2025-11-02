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

# Construct ASSETS_DATABASE_URL from individual parts if provided
if [ -n "$ASSETS_DB_USERNAME" ] && [ -n "$ASSETS_DB_PASSWORD" ] && [ -n "$ASSETS_DB_HOST" ] && [ -n "$ASSETS_DB_PORT" ]; then
  # Enforce TLS via sslmode=require
  export ASSETS_DATABASE_URL="postgresql://${ASSETS_DB_USERNAME}:${ASSETS_DB_PASSWORD}@${ASSETS_DB_HOST}:${ASSETS_DB_PORT}/postolio_assets?sslmode=require"
  echo "ASSETS_DATABASE_URL constructed successfully"
elif [ -n "$ASSETS_DB_USERNAME" ] && [ -n "$ASSETS_DB_PASSWORD" ] && [ -n "$ASSETS_DB_HOST" ]; then
  export ASSETS_DATABASE_URL="postgresql://${ASSETS_DB_USERNAME}:${ASSETS_DB_PASSWORD}@${ASSETS_DB_HOST}:5432/postolio_assets?sslmode=require"
  echo "ASSETS_DATABASE_URL constructed with default port"
fi

if [ -z "$ASSETS_DATABASE_URL" ]; then
  echo "ERROR: ASSETS_DATABASE_URL could not be constructed and is not provided"
  echo "Required environment variables: ASSETS_DB_USERNAME, ASSETS_DB_PASSWORD, ASSETS_DB_HOST [ASSETS_DB_PORT] or ASSETS_DATABASE_URL"
  exit 1
fi

echo "ASSETS_DATABASE_URL is configured"

# Ensure Prisma client is generated and run migrations (idempotent) from the database-assets package
echo "Running database migrations..."
cd /app/packages/libs/database-assets

# Check for failed migrations and resolve them
echo "Checking for failed migrations..."
if npx prisma migrate status 2>&1 | grep -q "migration.*failed"; then
  echo "Found failed migration, resolving..."
  npx prisma migrate resolve --applied $(npx prisma migrate status 2>&1 | grep "migration.*failed" | awk '{print $1}') || echo "Failed to resolve migration (might already be resolved)"
fi

# Generate client (safe if already generated)
npx prisma generate

# Apply migrations
npx prisma migrate deploy
echo "Migrations completed"

# Return to assets app directory
cd /app/packages/apps/assets

# Execute main command (CMD)
exec "$@"
