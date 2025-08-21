#!/bin/bash

# Content Scheduler Microservice Deployment Script
# Usage: ./deploy-scheduler.sh [environment] [alert-email]
# Example: ./deploy-scheduler.sh dev admin@example.com

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-dev}
ALERT_EMAIL=${2:-}
AWS_REGION=${AWS_REGION:-us-east-1}

echo -e "${GREEN}Content Scheduler Microservice Deployment${NC}"
echo -e "${GREEN}===========================================${NC}"
echo "Environment: $ENVIRONMENT"
echo "Region: $AWS_REGION"
echo "Alert Email: ${ALERT_EMAIL:-Not configured}"
echo ""

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    echo -e "${RED}Error: Invalid environment. Must be dev, staging, or prod${NC}"
    exit 1
fi

# Check AWS credentials
echo -e "${YELLOW}Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo -e "${RED}Error: AWS credentials not configured${NC}"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${GREEN}✓ AWS Account: $ACCOUNT_ID${NC}"

# Navigate to CDK directory
cd aws-infrastructure

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing CDK dependencies...${NC}"
    npm install
fi

# Install PowerTools layer dependencies
POWERTOOLS_DIR="lib/layers/powertools/nodejs"
if [ -d "$POWERTOOLS_DIR" ]; then
    echo -e "${YELLOW}Installing PowerTools layer dependencies...${NC}"
    cd "$POWERTOOLS_DIR"
    if [ ! -d "node_modules" ] || [ ! -f "package-lock.json" ]; then
        npm install
        echo -e "${GREEN}✓ PowerTools layer dependencies installed${NC}"
    else
        npm ci
        echo -e "${GREEN}✓ PowerTools layer dependencies updated${NC}"
    fi
    cd - > /dev/null
fi

# Bootstrap CDK if needed using dedicated check script
echo -e "${YELLOW}Checking CDK bootstrap status...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! "$SCRIPT_DIR/check-cdk-bootstrap.sh" "$ACCOUNT_ID" "$AWS_REGION"; then
    echo -e "${GREEN}✓ CDK already bootstrapped - skipping${NC}"
else
    echo -e "${YELLOW}Bootstrapping CDK...${NC}"
    npx cdk bootstrap aws://$ACCOUNT_ID/$AWS_REGION
fi

# Define stack name variable for consistency
STACK_NAME="ContentScheduler-$ENVIRONMENT"

# Synthesize the stack
echo -e "${YELLOW}Synthesizing CloudFormation template...${NC}"
CONTEXT_ARGS="-c environment=$ENVIRONMENT"
if [ -n "$ALERT_EMAIL" ]; then
    CONTEXT_ARGS="$CONTEXT_ARGS -c alertEmail=$ALERT_EMAIL"
fi

npx cdk synth $STACK_NAME $CONTEXT_ARGS

# Deploy the stack
echo -e "${YELLOW}Deploying Content Scheduler Stack...${NC}"
npx cdk deploy $STACK_NAME $CONTEXT_ARGS \
    --require-approval never \
    --outputs-file scheduler-outputs-$ENVIRONMENT.json

# Display outputs
if [ -f "scheduler-outputs-$ENVIRONMENT.json" ]; then
    echo -e "${GREEN}Deployment Complete!${NC}"
    echo -e "${GREEN}===========================================${NC}"
    echo "Stack Outputs:"
    cat scheduler-outputs-$ENVIRONMENT.json | jq .
    
    # Extract important values
    API_ENDPOINT=$(cat scheduler-outputs-$ENVIRONMENT.json | jq -r ".\"ContentScheduler-$ENVIRONMENT\".ApiEndpoint")
    SCHEDULES_TABLE=$(cat scheduler-outputs-$ENVIRONMENT.json | jq -r ".\"ContentScheduler-$ENVIRONMENT\".SchedulesTableName")
    VIDEO_BUCKET=$(cat scheduler-outputs-$ENVIRONMENT.json | jq -r ".\"ContentScheduler-$ENVIRONMENT\".VideoBucketName")
    
    echo ""
    echo -e "${GREEN}Key Resources:${NC}"
    echo "API Endpoint: $API_ENDPOINT"
    echo "Schedules Table: $SCHEDULES_TABLE"
    echo "Video Bucket: $VIDEO_BUCKET"
    
    # Create .env file for local development
    echo ""
    echo -e "${YELLOW}Creating .env.scheduler file...${NC}"
    cat > ../.env.scheduler <<EOF
# Content Scheduler Microservice Environment Variables
SCHEDULER_API_ENDPOINT=$API_ENDPOINT
SCHEDULER_SCHEDULES_TABLE=$SCHEDULES_TABLE
SCHEDULER_VIDEO_BUCKET=$VIDEO_BUCKET
SCHEDULER_ENVIRONMENT=$ENVIRONMENT
EOF
    echo -e "${GREEN}✓ Environment file created at .env.scheduler${NC}"
else
    echo -e "${RED}Error: Could not retrieve stack outputs${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Next Steps:${NC}"
echo "1. Update platform credentials in AWS Secrets Manager"
echo "2. Configure CORS settings for production"
echo "3. Set up monitoring dashboards in CloudWatch"
echo "4. Test the API endpoints"
echo ""
echo -e "${GREEN}Deployment successful!${NC}"