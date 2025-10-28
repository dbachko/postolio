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

# Construct DATABASE_URL from individual parts if provided
if [ -n "$DB_USERNAME" ] && [ -n "$DB_PASSWORD" ] && [ -n "$DB_HOST" ] && [ -n "$DB_PORT" ]; then
  # Enforce TLS via sslmode=require
  export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postolio?sslmode=require"
  echo "DATABASE_URL constructed successfully"
elif [ -n "$DB_USERNAME" ] && [ -n "$DB_PASSWORD" ] && [ -n "$DB_HOST" ]; then
  export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:5432/postolio?sslmode=require"
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
npx prisma migrate deploy
echo "Migrations completed"

# Return to API app directory
cd /app/packages/apps/api

# Execute main command (CMD)
exec "$@"

