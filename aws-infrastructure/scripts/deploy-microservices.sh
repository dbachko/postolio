#!/bin/bash

# Postolio Platform Microservices Deployment Script
# Usage: ./deploy-microservices.sh [dev|staging|prod] [alert-email]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get environment from argument or default to dev
ENVIRONMENT=${1:-dev}
ALERT_EMAIL=${2:-}

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    echo -e "${RED}Error: Invalid environment '$ENVIRONMENT'. Must be dev, staging, or prod.${NC}"
    exit 1
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Postolio Platform Microservices Deployment${NC}"
echo -e "${GREEN}Environment: ${YELLOW}$ENVIRONMENT${NC}"
if [ -n "$ALERT_EMAIL" ]; then
    echo -e "${GREEN}Alert Email: ${YELLOW}$ALERT_EMAIL${NC}"
fi
echo -e "${GREEN}========================================${NC}"

# Check AWS credentials
echo -e "\n${YELLOW}Checking AWS credentials...${NC}"
aws sts get-caller-identity > /dev/null 2>&1 || {
    echo -e "${RED}Error: AWS credentials not configured${NC}"
    exit 1
}

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-us-east-1}

echo -e "${GREEN}AWS Account: $ACCOUNT_ID${NC}"
echo -e "${GREEN}AWS Region: $REGION${NC}"

# Navigate to infrastructure directory
cd "$(dirname "$0")/.."

# Install CDK dependencies
echo -e "\n${YELLOW}Installing CDK dependencies...${NC}"
npm install

# Build Lambda layer
echo -e "\n${YELLOW}Building Lambda layer...${NC}"
cd layers/shared/nodejs
npm install --production
cd ../../..

# Compile TypeScript
echo -e "\n${YELLOW}Compiling TypeScript...${NC}"
npm run build

# Bootstrap CDK (if needed)
echo -e "\n${YELLOW}Checking CDK bootstrap...${NC}"
if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region $REGION > /dev/null 2>&1; then
    echo -e "${YELLOW}Bootstrapping CDK...${NC}"
    npx cdk bootstrap aws://$ACCOUNT_ID/$REGION
fi

# Deploy the stack
echo -e "\n${YELLOW}Deploying microservices stack...${NC}"
if [ -n "$ALERT_EMAIL" ]; then
    npx cdk deploy Postolio-Platform-$ENVIRONMENT \
        --app "npx ts-node --prefer-ts-exts bin/platform-microservices.ts" \
        --context environment=$ENVIRONMENT \
        --context alertEmail=$ALERT_EMAIL \
        --require-approval never \
        --outputs-file outputs-$ENVIRONMENT.json
else
    npx cdk deploy Postolio-Platform-$ENVIRONMENT \
        --app "npx ts-node --prefer-ts-exts bin/platform-microservices.ts" \
        --context environment=$ENVIRONMENT \
        --require-approval never \
        --outputs-file outputs-$ENVIRONMENT.json
fi

# Display outputs
if [ -f "outputs-$ENVIRONMENT.json" ]; then
    echo -e "\n${GREEN}========================================${NC}"
    echo -e "${GREEN}Deployment Complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
    
    echo -e "\n${YELLOW}Stack Outputs:${NC}"
    cat outputs-$ENVIRONMENT.json | jq -r '.["Postolio-Platform-'$ENVIRONMENT'"] | to_entries[] | "\(.key): \(.value)"'
    
    # Extract important URLs
    API_URL=$(cat outputs-$ENVIRONMENT.json | jq -r '.["Postolio-Platform-'$ENVIRONMENT'"].TokenServiceApiUrl')
    
    echo -e "\n${GREEN}========================================${NC}"
    echo -e "${GREEN}Important URLs:${NC}"
    echo -e "${YELLOW}Token Service API:${NC} $API_URL"
    echo -e "${GREEN}========================================${NC}"
else
    echo -e "\n${GREEN}Deployment complete!${NC}"
fi

echo -e "\n${YELLOW}Note: Remember to update the platform secrets in AWS Secrets Manager:${NC}"
echo -e "  aws secretsmanager put-secret-value --secret-id postolio/$ENVIRONMENT/platform-credentials --secret-string '{...}'"