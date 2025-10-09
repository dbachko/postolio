#!/bin/sh
set -e

# Debug: Print environment variables (without sensitive data)
echo "Starting container with environment:"
echo "NODE_ENV: ${NODE_ENV}"
echo "PORT: ${PORT}"
echo "DB_HOST is set: $([ -n "$DB_HOST" ] && echo "yes" || echo "no")"
echo "DB_USERNAME is set: $([ -n "$DB_USERNAME" ] && echo "yes" || echo "no")"
echo "DB_PASSWORD is set: $([ -n "$DB_PASSWORD" ] && echo "yes" || echo "no")"
echo "JWT_SECRET is set: $([ -n "$JWT_SECRET" ] && echo "yes" || echo "no")"

# Construct DATABASE_URL from individual components if they exist
if [ -n "$DB_USERNAME" ] && [ -n "$DB_PASSWORD" ] && [ -n "$DB_HOST" ] && [ -n "$DB_PORT" ]; then
  # Database name is always 'postolio' as defined in Foundation stack
  # Add sslmode=require for RDS Proxy TLS requirement
  export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postolio?sslmode=require"
  echo "DATABASE_URL constructed successfully"
elif [ -n "$DB_USERNAME" ] && [ -n "$DB_PASSWORD" ] && [ -n "$DB_HOST" ]; then
  # Default port if not provided
  export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:5432/postolio?sslmode=require"
  echo "DATABASE_URL constructed with default port"
fi

# If DATABASE_URL is still not set, check if it's provided directly
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL could not be constructed and is not provided"
  echo "Required environment variables: DB_USERNAME, DB_PASSWORD, DB_HOST"
  exit 1
fi

echo "DATABASE_URL is configured"

# Run Prisma migrations
echo "Running database migrations..."
cd /app/packages/libs/database
npx prisma migrate deploy
echo "Migrations completed"

# Return to app directory
cd /app/packages/apps/api

# Execute the main command
exec "$@"