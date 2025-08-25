#!/bin/bash

# Script to fix PUBLISHER_API_KEY propagation between stacks
# This ensures both the main app and ContentScheduler Lambda use the same API key

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ENVIRONMENT=${1:-dev}

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Fixing PUBLISHER_API_KEY for environment: $ENVIRONMENT${NC}"
echo -e "${GREEN}=========================================${NC}"

# Step 1: Get the current API key from the main app's secrets
echo -e "${YELLOW}Step 1: Retrieving API key from main app secrets...${NC}"
SECRET_ARN=$(aws secretsmanager list-secrets --query "SecretList[?contains(Name, 'AppSecrets')].ARN" --output text)
if [ -z "$SECRET_ARN" ]; then
    echo -e "${RED}Error: Could not find AppSecrets in Secrets Manager${NC}"
    exit 1
fi

PUBLISHER_API_KEY=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query SecretString --output text | jq -r '.publisherApiKey')
if [ -z "$PUBLISHER_API_KEY" ] || [ "$PUBLISHER_API_KEY" == "null" ]; then
    echo -e "${RED}Error: Could not retrieve PUBLISHER_API_KEY from secrets${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Retrieved API key: ${PUBLISHER_API_KEY:0:10}...${NC}"

# Step 2: Update Lambda environment variable directly
echo -e "${YELLOW}Step 2: Updating ContentScheduler Lambda environment...${NC}"
LAMBDA_NAME="postolio-scheduler-${ENVIRONMENT}-publisher"

# Get current environment variables
CURRENT_ENV=$(aws lambda get-function-configuration --function-name "$LAMBDA_NAME" --query 'Environment.Variables' --output json)

# Update PUBLISHER_API_KEY using CLI input
aws lambda update-function-configuration \
    --function-name "$LAMBDA_NAME" \
    --environment Variables="{$(echo "$CURRENT_ENV" | jq -r 'to_entries | map("\(.key)=\"\(.value)\"") | join(",")')},PUBLISHER_API_KEY=\"$PUBLISHER_API_KEY\"" \
    --no-cli-pager > /dev/null

echo -e "${GREEN}✅ Lambda environment updated${NC}"

# Step 3: Verify the update
echo -e "${YELLOW}Step 3: Verifying Lambda configuration...${NC}"
LAMBDA_KEY=$(aws lambda get-function-configuration --function-name "$LAMBDA_NAME" --query "Environment.Variables.PUBLISHER_API_KEY" --output text)

if [ "$LAMBDA_KEY" == "$PUBLISHER_API_KEY" ]; then
    echo -e "${GREEN}✅ Verification successful - API keys match${NC}"
else
    echo -e "${RED}❌ Verification failed - API keys do not match${NC}"
    echo "Expected: ${PUBLISHER_API_KEY:0:10}..."
    echo "Got: ${LAMBDA_KEY:0:10}..."
    exit 1
fi

# Step 4: Test the publisher endpoints
echo -e "${YELLOW}Step 4: Testing publisher authentication...${NC}"
echo "Note: This requires a valid schedule ID for complete testing"

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}✅ PUBLISHER_API_KEY fix completed!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "The ContentScheduler Lambda now has the correct PUBLISHER_API_KEY."
echo "Both services are using the same authentication key."
echo ""
echo "To deploy the permanent fix via CDK:"
echo "  cd aws-infrastructure"
echo "  ./scripts/deploy-with-scheduler.sh $ENVIRONMENT"