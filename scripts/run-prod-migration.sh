#!/bin/bash

# Script to run database migration on production RDS instance
# This adds the missing two-factor authentication and OAuth columns

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Running production database migration...${NC}"

# Get the environment (default to dev)
ENVIRONMENT=${1:-dev}

if [ "$ENVIRONMENT" != "dev" ] && [ "$ENVIRONMENT" != "prod" ]; then
    echo -e "${RED}Invalid environment. Use 'dev' or 'prod'${NC}"
    exit 1
fi

echo -e "${GREEN}Environment: $ENVIRONMENT${NC}"

# Get the stack name
STACK_NAME="Postolio-${ENVIRONMENT}"

# Get the database secret ARN from CloudFormation
echo -e "${YELLOW}Fetching database credentials from AWS Secrets Manager...${NC}"
DB_SECRET_ARN=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='DatabaseSecretArn'].OutputValue" \
    --output text 2>/dev/null || echo "")

if [ -z "$DB_SECRET_ARN" ]; then
    echo -e "${RED}Failed to get database secret ARN${NC}"
    exit 1
fi

# Get the database endpoint
DB_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='DatabaseEndpoint'].OutputValue" \
    --output text 2>/dev/null || echo "")

if [ -z "$DB_ENDPOINT" ]; then
    echo -e "${RED}Failed to get database endpoint${NC}"
    exit 1
fi

# Get database credentials from Secrets Manager
DB_CREDENTIALS=$(aws secretsmanager get-secret-value \
    --secret-id "$DB_SECRET_ARN" \
    --query 'SecretString' \
    --output text)

DB_USERNAME=$(echo "$DB_CREDENTIALS" | jq -r '.username')
DB_PASSWORD=$(echo "$DB_CREDENTIALS" | jq -r '.password')

# Extract host and port from endpoint
DB_HOST=$(echo "$DB_ENDPOINT" | cut -d':' -f1)
DB_PORT=$(echo "$DB_ENDPOINT" | cut -d':' -f2)
DB_NAME="postolio"

echo -e "${GREEN}Database Host: $DB_HOST${NC}"
echo -e "${GREEN}Database Port: $DB_PORT${NC}"
echo -e "${GREEN}Database Name: $DB_NAME${NC}"

# Create a temporary file with the migration SQL
MIGRATION_FILE="./prisma/migrations/20250122_add_auth_features/migration.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}Migration file not found: $MIGRATION_FILE${NC}"
    exit 1
fi

echo -e "${YELLOW}Running migration...${NC}"

# Run the migration using psql
PGPASSWORD="$DB_PASSWORD" psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USERNAME" \
    -d "$DB_NAME" \
    -f "$MIGRATION_FILE" \
    -v ON_ERROR_STOP=1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Migration completed successfully!${NC}"
    
    # Record the migration in the _prisma_migrations table
    echo -e "${YELLOW}Recording migration in Prisma migrations table...${NC}"
    
    MIGRATION_NAME="20250122_add_auth_features"
    CHECKSUM=$(sha256sum "$MIGRATION_FILE" | cut -d' ' -f1)
    
    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USERNAME" \
        -d "$DB_NAME" \
        -c "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) 
            VALUES ('$(uuidgen)', '$CHECKSUM', NOW(), '$MIGRATION_NAME', NULL, NULL, NOW(), 1) 
            ON CONFLICT (id) DO NOTHING;"
    
    echo -e "${GREEN}✅ Migration recorded in database!${NC}"
else
    echo -e "${RED}❌ Migration failed!${NC}"
    exit 1
fi

echo -e "${GREEN}🎉 Production database migration completed successfully!${NC}"