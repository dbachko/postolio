#!/bin/bash

# Postolio Platform Microservices Test Script
# Usage: ./test-microservices.sh [dev|staging|prod]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get environment from argument or default to dev
ENVIRONMENT=${1:-dev}

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Testing Postolio Microservices${NC}"
echo -e "${GREEN}Environment: ${YELLOW}$ENVIRONMENT${NC}"
echo -e "${GREEN}========================================${NC}"

# Navigate to infrastructure directory
cd "$(dirname "$0")/.."

# Check if outputs file exists
if [ ! -f "outputs-$ENVIRONMENT.json" ]; then
    echo -e "${RED}Error: outputs-$ENVIRONMENT.json not found. Please deploy first.${NC}"
    exit 1
fi

# Extract API URL from outputs
API_URL=$(cat outputs-$ENVIRONMENT.json | jq -r '.["Postolio-Platform-'$ENVIRONMENT'"].TokenServiceApiUrl')

if [ -z "$API_URL" ] || [ "$API_URL" = "null" ]; then
    echo -e "${RED}Error: Could not find API URL in outputs${NC}"
    exit 1
fi

echo -e "\n${YELLOW}API URL: $API_URL${NC}"

# Test data
TEST_USER_ID="test-user-$(date +%s)"
TEST_BRAND_ID="test-brand-$(date +%s)"
TEST_TOKEN="test-access-token-$(uuidgen)"

# Function to make API call and display result
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    
    echo -e "\n${BLUE}Testing: $description${NC}"
    echo -e "${YELLOW}$method $endpoint${NC}"
    
    if [ -n "$data" ]; then
        echo -e "Request body: $data"
        response=$(curl -s -X $method \
            -H "Content-Type: application/json" \
            -d "$data" \
            "${API_URL}${endpoint}" \
            -w "\nHTTP_STATUS:%{http_code}")
    else
        response=$(curl -s -X $method \
            "${API_URL}${endpoint}" \
            -w "\nHTTP_STATUS:%{http_code}")
    fi
    
    http_status=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
    body=$(echo "$response" | sed '/HTTP_STATUS/d')
    
    if [ "$http_status" -ge 200 ] && [ "$http_status" -lt 300 ]; then
        echo -e "${GREEN}✓ Success (HTTP $http_status)${NC}"
        if [ -n "$body" ]; then
            echo "$body" | jq . 2>/dev/null || echo "$body"
        fi
    else
        echo -e "${RED}✗ Failed (HTTP $http_status)${NC}"
        if [ -n "$body" ]; then
            echo "$body" | jq . 2>/dev/null || echo "$body"
        fi
    fi
}

# Test 1: Store a token
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Test 1: Store Token${NC}"
echo -e "${GREEN}========================================${NC}"

TOKEN_DATA=$(cat <<EOF
{
  "userId": "$TEST_USER_ID",
  "brandId": "$TEST_BRAND_ID",
  "platform": "instagram",
  "accessToken": "$TEST_TOKEN",
  "refreshToken": "test-refresh-token",
  "expiresAt": $(( $(date +%s) * 1000 + 3600000 ))
}
EOF
)

api_call "POST" "tokens" "$TOKEN_DATA" "Store Instagram token"

# Test 2: Retrieve the token
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Test 2: Retrieve Token${NC}"
echo -e "${GREEN}========================================${NC}"

api_call "GET" "tokens/$TEST_USER_ID/instagram" "" "Retrieve stored token"

# Test 3: Delete the token
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Test 3: Delete Token${NC}"
echo -e "${GREEN}========================================${NC}"

api_call "DELETE" "tokens/$TEST_USER_ID/instagram" "" "Delete stored token"

# Test 4: Verify deletion
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Test 4: Verify Deletion${NC}"
echo -e "${GREEN}========================================${NC}"

api_call "GET" "tokens/$TEST_USER_ID/instagram" "" "Verify token is deleted"

# Check Lambda logs
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Checking Recent Lambda Logs${NC}"
echo -e "${GREEN}========================================${NC}"

echo -e "\n${YELLOW}Recent errors (if any):${NC}"
aws logs filter-log-events \
    --log-group-name "/aws/lambda/postolio-$ENVIRONMENT-token-service" \
    --start-time $(( $(date +%s) * 1000 - 300000 )) \
    --filter-pattern "ERROR" \
    --max-items 5 2>/dev/null | jq -r '.events[].message' || echo "No recent errors"

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Test Complete!${NC}"
echo -e "${GREEN}========================================${NC}"

# Display useful commands
echo -e "\n${YELLOW}Useful commands:${NC}"
echo -e "View token service logs:"
echo -e "  aws logs tail /aws/lambda/postolio-$ENVIRONMENT-token-service --follow"
echo -e "\nView DLQ messages:"
echo -e "  aws sqs receive-message --queue-url \$(aws sqs get-queue-url --queue-name postolio-$ENVIRONMENT-publisher-dlq --query QueueUrl --output text)"
echo -e "\nList EventBridge rules:"
echo -e "  aws events list-rules --event-bus-name postolio-$ENVIRONMENT-platform-events"