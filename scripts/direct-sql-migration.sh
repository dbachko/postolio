#!/bin/bash

# Direct SQL migration script for immediate production fix
# This runs the migration directly against the RDS database

set -e

echo "==========================================="
echo "🚨 DIRECT SQL MIGRATION FOR S3 FIELDS"
echo "==========================================="
echo ""

# Check environment
if [ "$1" != "prod" ] && [ "$1" != "dev" ]; then
    echo "Usage: $0 [dev|prod]"
    exit 1
fi

ENV=$1
STACK_NAME="Postolio-$ENV"

echo "Environment: $ENV"
echo "Stack: $STACK_NAME"
echo ""

# Get the database secret ARN from CloudFormation
echo "Getting database credentials from AWS Secrets Manager..."
SECRET_ARN=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='DatabaseSecretArn'].OutputValue" \
    --output text)

if [ -z "$SECRET_ARN" ] || [ "$SECRET_ARN" = "None" ]; then
    echo "❌ Could not find database secret ARN"
    echo "Trying alternative method..."
    
    # Try to get from secret directly
    SECRET_ARN=$(aws secretsmanager list-secrets \
        --query "SecretList[?Name=='$STACK_NAME-db-secret'].ARN" \
        --output text)
fi

if [ -z "$SECRET_ARN" ] || [ "$SECRET_ARN" = "None" ]; then
    echo "❌ Could not find database secret"
    exit 1
fi

echo "Secret ARN: $SECRET_ARN"
echo ""

# Get database credentials
DB_CREDS=$(aws secretsmanager get-secret-value --secret-id $SECRET_ARN --query SecretString --output text)
DB_HOST=$(echo $DB_CREDS | jq -r .host)
DB_PORT=$(echo $DB_CREDS | jq -r .port)
DB_NAME=$(echo $DB_CREDS | jq -r .dbname)
DB_USER=$(echo $DB_CREDS | jq -r .username)
DB_PASS=$(echo $DB_CREDS | jq -r .password)

echo "Database host: $DB_HOST"
echo ""

# Create SQL file
cat > /tmp/migration.sql << 'SQL'
-- S3 Image Storage Migration
-- Add columns for S3 image storage

BEGIN;

-- Check if columns already exist and add them if not
DO $$ 
BEGIN
    -- Add s3ImageKey column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'content' 
                   AND column_name = 's3imagekey') THEN
        ALTER TABLE "public"."content" ADD COLUMN "s3ImageKey" TEXT;
        RAISE NOTICE 'Added column s3ImageKey';
    ELSE
        RAISE NOTICE 'Column s3ImageKey already exists';
    END IF;

    -- Add cdnImageUrl column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'content' 
                   AND column_name = 'cdnimageurl') THEN
        ALTER TABLE "public"."content" ADD COLUMN "cdnImageUrl" TEXT;
        RAISE NOTICE 'Added column cdnImageUrl';
    ELSE
        RAISE NOTICE 'Column cdnImageUrl already exists';
    END IF;

    -- Add imageRegion column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'content' 
                   AND column_name = 'imageregion') THEN
        ALTER TABLE "public"."content" ADD COLUMN "imageRegion" TEXT;
        RAISE NOTICE 'Added column imageRegion';
    ELSE
        RAISE NOTICE 'Column imageRegion already exists';
    END IF;

    -- Add retentionExpiresAt column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'content' 
                   AND column_name = 'retentionexpiresat') THEN
        ALTER TABLE "public"."content" ADD COLUMN "retentionExpiresAt" TIMESTAMP(3);
        RAISE NOTICE 'Added column retentionExpiresAt';
    ELSE
        RAISE NOTICE 'Column retentionExpiresAt already exists';
    END IF;
END $$;

-- Insert migration record if not exists
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
SELECT 
    '20250811232837',
    'a7c3d0e5f8b9c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2',
    NOW(),
    '20250811232837_add_s3_image_storage_fields',
    NULL,
    NULL,
    NOW(),
    1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" 
    WHERE migration_name = '20250811232837_add_s3_image_storage_fields'
);

COMMIT;

-- Verify the columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'content' 
AND column_name IN ('s3ImageKey', 'cdnImageUrl', 'imageRegion', 'retentionExpiresAt');
SQL

echo "Running migration..."
echo ""

# Run the migration
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f /tmp/migration.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration completed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Restart the ECS service to pick up schema changes:"
    echo "   aws ecs update-service --cluster Postolio-$ENV --service postolio-service --force-new-deployment"
    echo ""
    echo "2. Monitor the deployment in CloudWatch"
else
    echo ""
    echo "❌ Migration failed!"
    echo "Check the error messages above for details"
    exit 1
fi

# Clean up
rm -f /tmp/migration.sql

echo ""
echo "==========================================="
echo "✅ Direct SQL migration completed!"
echo "==========================================="