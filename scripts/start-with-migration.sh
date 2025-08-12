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

# Run Prisma migrations with retry logic
echo "Running database migrations..."
MAX_RETRIES=5
RETRY_COUNT=0

while [ ${RETRY_COUNT} -lt ${MAX_RETRIES} ]; do
    echo "Migration attempt $((RETRY_COUNT + 1)) of ${MAX_RETRIES}..."
    
    # Set DATABASE_URL if not already set (useful for local testing)
    if [ -z "${DATABASE_URL}" ]; then
        echo "Warning: DATABASE_URL not set, migration may fail"
    fi
    
    if npx prisma migrate deploy --schema=./prisma/schema.prisma 2>&1; then
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

# Start the application
echo "Starting application server..."
exec npm start