#!/bin/bash

# Script to run database migration via ECS task
# This creates a one-time ECS task to apply migrations to production

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-prod}
AWS_REGION=${AWS_REGION:-us-east-1}
CLUSTER_NAME="Postolio-${ENVIRONMENT}-PostolioCluster"

echo -e "${GREEN}🚀 Running database migration on ECS${NC}"
echo "Environment: $ENVIRONMENT"
echo "Region: $AWS_REGION"
echo ""

# Get the latest task definition
echo -e "${YELLOW}Getting latest task definition...${NC}"
TASK_DEFINITION=$(aws ecs list-task-definitions \
    --family-prefix "Postolio-${ENVIRONMENT}" \
    --sort DESC \
    --max-items 1 \
    --query 'taskDefinitionArns[0]' \
    --output text \
    --region $AWS_REGION)

if [ -z "$TASK_DEFINITION" ]; then
    echo -e "${RED}❌ Could not find task definition${NC}"
    exit 1
fi

echo "Task Definition: $TASK_DEFINITION"

# Get subnet and security group from the service
echo -e "${YELLOW}Getting network configuration...${NC}"
NETWORK_CONFIG=$(aws ecs describe-services \
    --cluster $CLUSTER_NAME \
    --services "Postolio-${ENVIRONMENT}-PostolioService" \
    --query 'services[0].networkConfiguration.awsvpcConfiguration' \
    --output json \
    --region $AWS_REGION 2>/dev/null || echo "{}")

if [ "$NETWORK_CONFIG" = "{}" ]; then
    echo -e "${RED}❌ Could not get network configuration from service${NC}"
    echo "Please ensure the ECS service is running"
    exit 1
fi

SUBNETS=$(echo $NETWORK_CONFIG | jq -r '.subnets | join(",")')
SECURITY_GROUPS=$(echo $NETWORK_CONFIG | jq -r '.securityGroups | join(",")')

echo "Subnets: $SUBNETS"
echo "Security Groups: $SECURITY_GROUPS"

# Create a one-time task to run migrations
echo -e "${YELLOW}Creating migration task...${NC}"
TASK_ARN=$(aws ecs run-task \
    --cluster $CLUSTER_NAME \
    --task-definition $TASK_DEFINITION \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUPS],assignPublicIp=ENABLED}" \
    --overrides '{
        "containerOverrides": [
            {
                "name": "app",
                "command": ["sh", "-c", "npx prisma migrate deploy && echo Migration completed successfully"]
            }
        ]
    }' \
    --query 'tasks[0].taskArn' \
    --output text \
    --region $AWS_REGION)

if [ -z "$TASK_ARN" ]; then
    echo -e "${RED}❌ Failed to create migration task${NC}"
    exit 1
fi

echo "Task ARN: $TASK_ARN"
echo ""
echo -e "${YELLOW}Waiting for migration to complete...${NC}"

# Wait for task to complete
aws ecs wait tasks-stopped \
    --cluster $CLUSTER_NAME \
    --tasks $TASK_ARN \
    --region $AWS_REGION

# Check task status
EXIT_CODE=$(aws ecs describe-tasks \
    --cluster $CLUSTER_NAME \
    --tasks $TASK_ARN \
    --query 'tasks[0].containers[0].exitCode' \
    --output text \
    --region $AWS_REGION)

if [ "$EXIT_CODE" = "0" ]; then
    echo -e "${GREEN}✅ Migration completed successfully!${NC}"
    echo ""
    echo "The S3 image storage fields have been added to the database:"
    echo "  - s3ImageKey"
    echo "  - cdnImageUrl"
    echo "  - imageRegion"
    echo "  - retentionExpiresAt"
else
    echo -e "${RED}❌ Migration failed with exit code: $EXIT_CODE${NC}"
    echo ""
    echo "Checking logs..."
    
    # Get log stream name
    LOG_STREAM=$(aws ecs describe-tasks \
        --cluster $CLUSTER_NAME \
        --tasks $TASK_ARN \
        --query 'tasks[0].containers[0].logStreamName' \
        --output text \
        --region $AWS_REGION)
    
    if [ "$LOG_STREAM" != "None" ] && [ -n "$LOG_STREAM" ]; then
        echo "Log stream: $LOG_STREAM"
        echo ""
        echo "Recent logs:"
        aws logs get-log-events \
            --log-group-name "/ecs/Postolio-${ENVIRONMENT}" \
            --log-stream-name "$LOG_STREAM" \
            --limit 50 \
            --region $AWS_REGION \
            --query 'events[*].message' \
            --output text
    fi
    
    exit 1
fi