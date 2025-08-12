#!/bin/bash

# Hotfix script to add S3 fields to production database
# This can be run manually via ECS task or directly on the database

set -e

echo "🔧 Hotfix: Adding S3 image storage fields to production database"
echo "=================================================="

# Check if we have DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL environment variable is not set"
    echo "Please set it to your production database URL"
    exit 1
fi

echo "📊 Checking current database state..."

# Run the migration using Prisma
echo "🚀 Applying S3 fields migration..."
npx prisma migrate deploy

if [ $? -eq 0 ]; then
    echo "✅ Migration applied successfully!"
    echo ""
    echo "The following fields have been added to the content table:"
    echo "  - s3ImageKey (TEXT)"
    echo "  - cdnImageUrl (TEXT)"
    echo "  - imageRegion (TEXT)"
    echo "  - retentionExpiresAt (TIMESTAMP)"
    echo ""
    echo "🎉 Database is now ready for S3 image storage!"
else
    echo "❌ Migration failed. Please check the error messages above."
    exit 1
fi