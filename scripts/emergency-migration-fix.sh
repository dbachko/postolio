#!/bin/bash

# Emergency script to manually run database migration in production
# This script can be executed via ECS exec or run-task

set -e

echo "==========================================="
echo "🚨 EMERGENCY DATABASE MIGRATION FIX"
echo "==========================================="
echo "Time: $(date)"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we have required parameters
if [ "$1" = "prod" ] || [ "$1" = "dev" ]; then
    ENV=$1
    echo -e "${YELLOW}Environment: $ENV${NC}"
else
    echo "Usage: $0 [dev|prod]"
    echo "Example: $0 prod"
    exit 1
fi

# Set cluster and service names based on environment
if [ "$ENV" = "prod" ]; then
    CLUSTER="Postolio-prod"
    SERVICE="postolio-service"
    STACK_NAME="Postolio-prod"
else
    CLUSTER="Postolio-dev"
    SERVICE="postolio-service"
    STACK_NAME="Postolio-dev"
fi

echo ""
echo "Configuration:"
echo "  Cluster: $CLUSTER"
echo "  Service: $SERVICE"
echo ""

# Function to run command in ECS task
run_in_ecs() {
    local COMMAND=$1
    echo -e "${YELLOW}Finding running task...${NC}"
    
    # Get the first running task
    TASK_ARN=$(aws ecs list-tasks --cluster $CLUSTER --service-name $SERVICE --desired-status RUNNING --query 'taskArns[0]' --output text)
    
    if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
        echo -e "${RED}❌ No running tasks found${NC}"
        return 1
    fi
    
    echo "Task ARN: $TASK_ARN"
    echo ""
    echo -e "${YELLOW}Executing command in container...${NC}"
    
    # Execute the command
    aws ecs execute-command \
        --cluster $CLUSTER \
        --task $TASK_ARN \
        --container postolio-container \
        --interactive \
        --command "$COMMAND"
}

# Step 1: Check current database state
echo -e "${YELLOW}Step 1: Checking database state...${NC}"
run_in_ecs "npx prisma migrate status" || true

echo ""
echo -e "${YELLOW}Step 2: Running database migration...${NC}"
run_in_ecs "npx prisma migrate deploy --schema=./prisma/schema.prisma"

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Migration completed successfully!${NC}"
    
    echo ""
    echo -e "${YELLOW}Step 3: Verifying migration...${NC}"
    run_in_ecs "npx prisma migrate status"
    
    echo ""
    echo -e "${YELLOW}Step 4: Restarting service to ensure all containers have latest schema...${NC}"
    aws ecs update-service --cluster $CLUSTER --service $SERVICE --force-new-deployment
    
    echo ""
    echo -e "${GREEN}✅ Service restart initiated${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Wait 2-3 minutes for new containers to start"
    echo "2. Check application logs in CloudWatch"
    echo "3. Test the application functionality"
else
    echo ""
    echo -e "${RED}❌ Migration failed!${NC}"
    echo ""
    echo "Troubleshooting steps:"
    echo "1. Check CloudWatch logs for detailed error"
    echo "2. Verify DATABASE_URL is set correctly in ECS task"
    echo "3. Check network connectivity to RDS"
    echo "4. Try running migration directly with SQL:"
    echo ""
    echo "SQL to run manually if needed:"
    cat << 'SQL'
-- Add S3 image storage fields to content table
ALTER TABLE "public"."content" 
ADD COLUMN IF NOT EXISTS "cdnImageUrl" TEXT,
ADD COLUMN IF NOT EXISTS "imageRegion" TEXT,
ADD COLUMN IF NOT EXISTS "retentionExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "s3ImageKey" TEXT;
SQL
    exit 1
fi

echo ""
echo "==========================================="
echo "🎉 Emergency fix completed!"
echo "==========================================="