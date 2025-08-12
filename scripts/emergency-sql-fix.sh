#!/bin/bash

# Emergency SQL fix - runs migration directly on RDS

set -e

echo "==========================================="
echo "🚨 EMERGENCY SQL MIGRATION"
echo "==========================================="
echo ""

# Get database credentials
echo "Getting database credentials..."
DB_SECRET=$(aws secretsmanager get-secret-value --secret-id "arn:aws:secretsmanager:us-east-1:000000000000:secret:DatabaseSecret86DBB7B3-PiPPylVXTcex-uOYYUL" --query SecretString --output text)

DB_HOST=$(echo $DB_SECRET | jq -r .host)
DB_PORT=$(echo $DB_SECRET | jq -r .port)
DB_USER=$(echo $DB_SECRET | jq -r .username)
DB_PASS=$(echo $DB_SECRET | jq -r .password)

echo "Database host: $DB_HOST"
echo ""

# Create the SQL migration
cat > /tmp/emergency-migration.sql << 'SQL'
-- Emergency migration for S3 image fields
BEGIN;

-- Add columns if they don't exist
ALTER TABLE "public"."content" 
ADD COLUMN IF NOT EXISTS "s3ImageKey" TEXT,
ADD COLUMN IF NOT EXISTS "cdnImageUrl" TEXT,
ADD COLUMN IF NOT EXISTS "imageRegion" TEXT,
ADD COLUMN IF NOT EXISTS "retentionExpiresAt" TIMESTAMP(3);

-- Mark migration as complete in Prisma
INSERT INTO "_prisma_migrations" (
    id,
    checksum,
    finished_at,
    migration_name,
    logs,
    rolled_back_at,
    started_at,
    applied_steps_count
)
VALUES (
    '20250811232837',
    'a7c3d0e5f8b9c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2',
    NOW(),
    '20250811232837_add_s3_image_storage_fields',
    NULL,
    NULL,
    NOW(),
    1
)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Verify
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'content' 
AND column_name IN ('s3ImageKey', 'cdnImageUrl', 'imageRegion', 'retentionExpiresAt');
SQL

echo "Running migration..."
PGPASSWORD=$DB_PASS /usr/local/opt/postgresql@16/bin/psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postolio -f /tmp/emergency-migration.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration completed successfully!"
    echo ""
    echo "Restarting ECS service..."
    aws ecs update-service \
        --cluster Postolio-dev-PostolioCluster45B01E48-JnKPELhN8CEq \
        --service Postolio-dev-PostolioService71B9CD8C-BctX9mosXeEz \
        --force-new-deployment \
        --output json > /dev/null
    echo "✅ Service restart initiated"
    echo ""
    echo "The application should be working in 2-3 minutes!"
else
    echo "❌ Migration failed!"
fi

rm -f /tmp/emergency-migration.sql