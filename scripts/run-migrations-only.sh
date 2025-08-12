#!/bin/sh

# Migration-only script for ECS task execution
# This script is designed to run as a separate ECS task before deployment
# Compatible with Alpine Linux's sh shell (BusyBox ash)

set -e

echo "========================================="
echo "Prisma Database Migration Runner"
echo "Time: $(date)"
echo "========================================="

# Check for required environment variables
if [ -z "${DATABASE_URL}" ]; then
    echo "ERROR: DATABASE_URL environment variable is not set"
    exit 1
fi

echo "Database URL configured (connection string hidden for security)"

# Run migrations
echo "Starting database migration..."

if npx prisma migrate deploy --schema=./prisma/schema.prisma; then
    echo "========================================="
    echo "✅ Database migrations completed successfully"
    echo "Time: $(date)"
    echo "========================================="
    exit 0
else
    echo "========================================="
    echo "❌ Database migration failed"
    echo "Time: $(date)"
    echo "========================================="
    exit 1
fi