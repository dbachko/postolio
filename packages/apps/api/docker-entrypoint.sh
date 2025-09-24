#!/bin/sh
set -e

# Construct DATABASE_URL from individual components if they exist
if [ -n "$DB_USERNAME" ] && [ -n "$DB_PASSWORD" ] && [ -n "$DB_HOST" ] && [ -n "$DB_PORT" ] && [ -n "$DB_NAME" ]; then
  export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  echo "DATABASE_URL constructed from individual components"
fi

# If DATABASE_URL is still not set, check if it's provided directly
if [ -z "$DATABASE_URL" ]; then
  echo "Warning: DATABASE_URL is not set"
fi

# Execute the main command
exec "$@"