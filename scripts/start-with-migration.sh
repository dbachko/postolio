#!/bin/sh

# Start script with database migration
# This ensures migrations are applied before the application starts
# Compatible with Alpine Linux's sh shell (BusyBox ash)

echo "Starting Postolio with database migration..."

# Add random delay to prevent race conditions (0-30 seconds)
# Using /dev/urandom for POSIX compliance (Alpine's sh doesn't have $RANDOM)
if [ -r /dev/urandom ]; then
    # Generate random number between 0 and 29
    DELAY=$(( $(od -An -N2 -i /dev/urandom | sed 's/ //g') % 30 ))
    echo "Adding startup delay of ${DELAY} seconds to prevent race conditions..."
    sleep ${DELAY}
else
    # Fallback to fixed delay if /dev/urandom is not available
    echo "Adding fixed startup delay of 5 seconds..."
    sleep 5
fi

# Construct DATABASE_URL from components if not set
if [ -z "${DATABASE_URL}" ]; then
    if [ -n "${DB_HOST}" ] && [ -n "${DB_USERNAME}" ] && [ -n "${DB_PASSWORD}" ]; then
        DB_PORT="${DB_PORT:-5433}"
        DB_NAME="${DB_NAME:-postolio}"
        export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
        echo "DATABASE_URL constructed from components"
    else
        echo "Warning: DATABASE_URL not set and cannot be constructed from components"
        echo "Available environment variables:"
        echo "  DB_HOST: ${DB_HOST:-not set}"
        echo "  DB_USERNAME: ${DB_USERNAME:-not set}"
        echo "  DB_PASSWORD: ${DB_PASSWORD:+[set]}"
        echo "  DB_PORT: ${DB_PORT:-not set}"
    fi
fi

# Run Prisma migrations with retry logic (skip if schema is absent)
# Check both monorepo and standalone locations
SCHEMA_PATH=""
if [ -f ./packages/libs/database/prisma/schema.prisma ]; then
  SCHEMA_PATH="./packages/libs/database/prisma/schema.prisma"
elif [ -f ./prisma/schema.prisma ]; then
  SCHEMA_PATH="./prisma/schema.prisma"
fi

if [ -n "${SCHEMA_PATH}" ]; then
  echo "Running database migrations using schema at ${SCHEMA_PATH}..."
  MAX_RETRIES=5
  RETRY_COUNT=0

  while [ ${RETRY_COUNT} -lt ${MAX_RETRIES} ]; do
      echo "Migration attempt $((RETRY_COUNT + 1)) of ${MAX_RETRIES}..."
      
      if npx prisma migrate deploy --schema=${SCHEMA_PATH} 2>&1; then
          echo "Database migrations completed successfully"
          break
      else
          RETRY_COUNT=$((RETRY_COUNT + 1))
          if [ ${RETRY_COUNT} -lt ${MAX_RETRIES} ]; then
              WAIT_TIME=$((RETRY_COUNT * 10))
              echo "Migration failed, retrying in ${WAIT_TIME} seconds..."
              sleep ${WAIT_TIME}
          else
              echo "Database migration failed after ${MAX_RETRIES} attempts!"
              echo "Please check database connectivity and migration files"
              exit 1
          fi
      fi
  done
else
  echo "Prisma schema not found — skipping migrations"
fi

# Start the application
echo "Starting application server..."

# Prefer monorepo path for API dist, fall back to local dist
if [ -f packages/apps/api/dist/server.js ]; then
  exec node packages/apps/api/dist/server.js
elif [ -f dist/server.js ]; then
  exec node dist/server.js
else
  echo "Could not find compiled server entry (dist/server.js). Exiting."
  exit 1
fi
