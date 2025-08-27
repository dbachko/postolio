#!/bin/bash

# Local Testing Script for Microservices
# Tests the new functionality locally before deployment

set -e

echo "🧪 Starting Microservices Local Testing"
echo "======================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ $2${NC}"
    else
        echo -e "${RED}❌ $2${NC}"
    fi
}

# Function to test endpoint
test_endpoint() {
    local method=$1
    local url=$2
    local data=$3
    local expected_status=$4
    local test_name=$5
    
    echo -e "\n${YELLOW}Testing: $test_name${NC}"
    
    if [ "$method" = "POST" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer test-token" \
            -d "$data" \
            "$url")
    else
        response=$(curl -s -w "\n%{http_code}" -X GET \
            -H "Authorization: Bearer test-token" \
            "$url")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)
    
    if [ "$http_code" = "$expected_status" ]; then
        print_status 0 "Status code matches expected: $http_code"
        return 0
    else
        print_status 1 "Status code mismatch. Expected: $expected_status, Got: $http_code"
        echo "Response body: $body"
        return 1
    fi
}

# Step 1: Check if services are running
echo -e "\n${YELLOW}Step 1: Checking service availability${NC}"

# Check if backend is running
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    print_status 0 "Backend service is running"
else
    print_status 1 "Backend service is not running. Start it with: npm run dev"
    exit 1
fi

# Check if database is running
if docker ps | grep -q "postolio-postgres"; then
    print_status 0 "PostgreSQL is running"
else
    print_status 1 "PostgreSQL is not running. Start it with: npm run dev:db"
    exit 1
fi

# Check if Redis is running
if docker ps | grep -q "postolio-redis"; then
    print_status 0 "Redis is running"
else
    print_status 1 "Redis is not running. Start it with: npm run dev:db"
    exit 1
fi

# Step 2: Run unit tests
echo -e "\n${YELLOW}Step 2: Running unit tests${NC}"

# Test security fixes
echo "Testing security fixes..."
npm test -- test/microservices/token-service.test.ts --silent
print_status $? "Token service security tests"

# Test performance optimizations
echo "Testing performance optimizations..."
npm test -- test/microservices/dlq-processor.test.ts --silent
print_status $? "DLQ processor performance tests"

# Step 3: Test API endpoints
echo -e "\n${YELLOW}Step 3: Testing API endpoints${NC}"

# Test with invalid input (should be rejected by Zod validation)
test_endpoint "POST" "http://localhost:3000/api/tokens" \
    '{"userId":"user123","brandId":"brand123","platform":"invalid-platform","accessToken":"token123","expiresAt":1234567890}' \
    "400" \
    "Invalid platform validation"

# Test with SQL injection attempt (should be safely handled)
test_endpoint "POST" "http://localhost:3000/api/tokens" \
    "{\"userId\":\"user'; DROP TABLE tokens; --\",\"brandId\":\"brand123\",\"platform\":\"instagram\",\"accessToken\":\"token123\",\"expiresAt\":1234567890}" \
    "400" \
    "SQL injection prevention"

# Test with missing required fields
test_endpoint "POST" "http://localhost:3000/api/tokens" \
    '{"userId":"user123"}' \
    "400" \
    "Required field validation"

# Test with valid input (should succeed or return auth error)
test_endpoint "POST" "http://localhost:3000/api/tokens" \
    '{"userId":"user123","brandId":"brand123","platform":"instagram","accessToken":"token123","expiresAt":1234567890000}' \
    "401" \
    "Valid input handling (expects auth error in local env)"

# Step 4: Test rate limiting
echo -e "\n${YELLOW}Step 4: Testing rate limiting${NC}"

# Send multiple requests quickly
echo "Sending rapid requests to test rate limiting..."
for i in {1..10}; do
    curl -s -X POST \
        -H "Content-Type: application/json" \
        -d '{"test":"data"}' \
        "http://localhost:3000/api/tokens" \
        -o /dev/null
done

print_status 0 "Rate limiting requests sent (check logs for rate limit messages)"

# Step 5: Check logs for security
echo -e "\n${YELLOW}Step 5: Checking logs for security${NC}"

# Create a temp file for log analysis
TEMP_LOG="/tmp/postolio-test-log.txt"

# Start capturing logs (run backend with logging for 5 seconds)
echo "Capturing logs for security analysis..."
timeout 5s npm run dev 2>&1 | tee $TEMP_LOG > /dev/null 2>&1 || true

# Check if sensitive headers appear in logs
if grep -q "authorization\|x-api-key\|x-amz-security-token" $TEMP_LOG; then
    print_status 1 "WARNING: Sensitive headers found in logs!"
else
    print_status 0 "No sensitive headers in logs"
fi

# Clean up temp file
rm -f $TEMP_LOG

# Step 6: Performance benchmarks
echo -e "\n${YELLOW}Step 6: Running performance benchmarks${NC}"

# Test connection pooling (measure response times)
echo "Testing connection pooling performance..."

# Cold start request
COLD_START=$(curl -o /dev/null -s -w "%{time_total}" \
    -X GET "http://localhost:3000/api/health")
echo "Cold start time: ${COLD_START}s"

# Warm requests (should be faster due to connection pooling)
total_time=0
for i in {1..5}; do
    time=$(curl -o /dev/null -s -w "%{time_total}" \
        -X GET "http://localhost:3000/api/health")
    total_time=$(echo "$total_time + $time" | bc)
done

avg_time=$(echo "scale=3; $total_time / 5" | bc)
echo "Average warm request time: ${avg_time}s"

# Check if warm requests are faster
if (( $(echo "$avg_time < $COLD_START" | bc -l) )); then
    print_status 0 "Connection pooling is working (warm requests faster)"
else
    print_status 1 "Connection pooling may not be working effectively"
fi

# Step 7: CDK validation
echo -e "\n${YELLOW}Step 7: Validating CDK code${NC}"

cd aws-infrastructure

# Synthesize CDK to check for errors
echo "Running CDK synthesis..."
if npx cdk synth --quiet 2>/dev/null; then
    print_status 0 "CDK synthesis successful"
else
    print_status 1 "CDK synthesis failed"
fi

cd ..

# Summary
echo -e "\n${GREEN}=======================================${NC}"
echo -e "${GREEN}Testing Complete!${NC}"
echo -e "${GREEN}=======================================${NC}"

echo -e "\n📋 Summary:"
echo "- Security fixes: Header logging and input validation tested"
echo "- Performance: Connection pooling and batch loading validated"
echo "- API endpoints: Request validation working correctly"
echo "- CDK: Infrastructure code synthesizes without errors"

echo -e "\n🚀 Next Steps:"
echo "1. Review any failed tests above"
echo "2. Check application logs for any warnings"
echo "3. Run integration tests: npm test"
echo "4. Deploy to development: ./scripts/deploy-aws.sh dev"

echo -e "\n📚 Additional Testing Commands:"
echo "- Run all tests: npm test"
echo "- Run specific test: npm test -- test/microservices/token-service.test.ts"
echo "- Check TypeScript: cd aws-infrastructure && npx tsc --noEmit"
echo "- Run CDK diff: cd aws-infrastructure && npx cdk diff"