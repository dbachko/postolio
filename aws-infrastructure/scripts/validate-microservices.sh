#!/bin/bash

# Postolio Platform Microservices Validation Script
# Usage: ./validate-microservices.sh [dev|staging|prod]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get environment from argument or default to dev
ENVIRONMENT=${1:-dev}

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Validating Postolio Microservices Stack${NC}"
echo -e "${GREEN}Environment: ${YELLOW}$ENVIRONMENT${NC}"
echo -e "${GREEN}======================================${NC}"

# Navigate to infrastructure directory
cd "$(dirname "$0")/.."

# Check for required files
echo -e "\n${YELLOW}Checking required files...${NC}"

required_files=(
    "bin/platform-microservices.ts"
    "lib/stacks/platform-microservices-stack.ts"
    "lib/lambdas/token-service/index.ts"
    "lib/lambdas/token-rotation/index.ts"
    "lib/lambdas/scheduler-service/index.ts"
    "lib/lambdas/publishers/instagram/index.ts"
    "lib/lambdas/publishers/facebook/index.ts"
    "lib/lambdas/publishers/linkedin/index.ts"
    "lib/lambdas/publishers/tiktok/index.ts"
    "layers/shared/nodejs/package.json"
)

missing_files=()
for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $file"
    else
        echo -e "${RED}✗${NC} $file"
        missing_files+=("$file")
    fi
done

if [ ${#missing_files[@]} -gt 0 ]; then
    echo -e "\n${RED}Error: Missing required files:${NC}"
    for file in "${missing_files[@]}"; do
        echo -e "  - $file"
    done
    exit 1
fi

# Check CDK installation
echo -e "\n${YELLOW}Checking CDK installation...${NC}"
if command -v cdk &> /dev/null; then
    CDK_VERSION=$(cdk --version | cut -d' ' -f1)
    echo -e "${GREEN}✓${NC} CDK version: $CDK_VERSION"
else
    echo -e "${RED}✗ CDK not found. Installing...${NC}"
    npm install -g aws-cdk
fi

# Install dependencies
echo -e "\n${YELLOW}Installing dependencies...${NC}"
npm install

# Build TypeScript
echo -e "\n${YELLOW}Building TypeScript...${NC}"
npm run build 2>/dev/null || npx tsc

# Synthesize CDK stack
echo -e "\n${YELLOW}Synthesizing CDK stack...${NC}"
npx cdk synth Postolio-Platform-$ENVIRONMENT \
    --app "npx ts-node --prefer-ts-exts bin/platform-microservices.ts" \
    --context environment=$ENVIRONMENT \
    --quiet > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Stack synthesis successful"
else
    echo -e "${RED}✗${NC} Stack synthesis failed"
    echo -e "\n${YELLOW}Running verbose synthesis for debugging:${NC}"
    npx cdk synth Postolio-Platform-$ENVIRONMENT \
        --app "npx ts-node --prefer-ts-exts bin/platform-microservices.ts" \
        --context environment=$ENVIRONMENT
    exit 1
fi

# Validate CloudFormation template
echo -e "\n${YELLOW}Validating CloudFormation template...${NC}"
TEMPLATE_FILE="cdk.out/Postolio-Platform-$ENVIRONMENT.template.json"

if [ -f "$TEMPLATE_FILE" ]; then
    # Check template size
    TEMPLATE_SIZE=$(stat -f%z "$TEMPLATE_FILE" 2>/dev/null || stat -c%s "$TEMPLATE_FILE" 2>/dev/null || echo 0)
    MAX_SIZE=1000000 # 1MB limit for CloudFormation templates
    
    if [ "$TEMPLATE_SIZE" -gt "$MAX_SIZE" ]; then
        echo -e "${RED}✗${NC} Template size ($TEMPLATE_SIZE bytes) exceeds CloudFormation limit ($MAX_SIZE bytes)"
        echo -e "${YELLOW}Consider splitting the stack or using nested stacks${NC}"
        exit 1
    else
        echo -e "${GREEN}✓${NC} Template size: $TEMPLATE_SIZE bytes"
    fi
    
    # Count resources
    RESOURCE_COUNT=$(jq '.Resources | length' "$TEMPLATE_FILE")
    MAX_RESOURCES=500 # CloudFormation limit
    
    if [ "$RESOURCE_COUNT" -gt "$MAX_RESOURCES" ]; then
        echo -e "${RED}✗${NC} Resource count ($RESOURCE_COUNT) exceeds CloudFormation limit ($MAX_RESOURCES)"
        echo -e "${YELLOW}Consider splitting the stack${NC}"
        exit 1
    else
        echo -e "${GREEN}✓${NC} Resource count: $RESOURCE_COUNT"
    fi
    
    # List key resources
    echo -e "\n${YELLOW}Key resources in stack:${NC}"
    jq -r '.Resources | to_entries[] | select(.value.Type | startswith("AWS::Lambda::Function")) | "  Lambda: \(.key)"' "$TEMPLATE_FILE"
    jq -r '.Resources | to_entries[] | select(.value.Type == "AWS::DynamoDB::Table") | "  Table: \(.key)"' "$TEMPLATE_FILE"
    jq -r '.Resources | to_entries[] | select(.value.Type == "AWS::Events::EventBus") | "  EventBus: \(.key)"' "$TEMPLATE_FILE"
    jq -r '.Resources | to_entries[] | select(.value.Type == "AWS::ApiGateway::RestApi") | "  API: \(.key)"' "$TEMPLATE_FILE"
else
    echo -e "${RED}✗${NC} Template file not found"
    exit 1
fi

# Check for potential deployment issues
echo -e "\n${YELLOW}Checking for potential issues...${NC}"

# Check AWS credentials
if aws sts get-caller-identity > /dev/null 2>&1; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    REGION=${AWS_REGION:-us-east-1}
    echo -e "${GREEN}✓${NC} AWS credentials configured (Account: $ACCOUNT_ID, Region: $REGION)"
else
    echo -e "${YELLOW}⚠${NC} AWS credentials not configured - deployment will fail"
fi

# Check CDK bootstrap status
if aws cloudformation describe-stacks --stack-name CDKToolkit --region $REGION > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} CDK bootstrap stack exists"
else
    echo -e "${YELLOW}⚠${NC} CDK not bootstrapped - run: npx cdk bootstrap aws://$ACCOUNT_ID/$REGION"
fi

# Display deployment commands
echo -e "\n${GREEN}======================================${NC}"
echo -e "${GREEN}Validation Complete!${NC}"
echo -e "${GREEN}======================================${NC}"

echo -e "\n${YELLOW}Next steps:${NC}"
echo -e "1. Review any warnings above"
echo -e "2. Deploy the stack:"
echo -e "   ${BLUE}./scripts/deploy-microservices.sh $ENVIRONMENT${NC}"
echo -e "3. After deployment, test the services:"
echo -e "   ${BLUE}./scripts/test-microservices.sh $ENVIRONMENT${NC}"

echo -e "\n${YELLOW}Useful CDK commands:${NC}"
echo -e "  ${BLUE}npx cdk diff Postolio-Platform-$ENVIRONMENT${NC} - Show what will be deployed"
echo -e "  ${BLUE}npx cdk deploy Postolio-Platform-$ENVIRONMENT --hotswap${NC} - Fast deploy for Lambda changes"
echo -e "  ${BLUE}npx cdk destroy Postolio-Platform-$ENVIRONMENT${NC} - Tear down the stack"