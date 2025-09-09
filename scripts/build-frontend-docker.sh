#!/bin/bash

# Build Frontend Docker Image with Google Client ID from AWS Secrets Manager
# This script is for building containerized frontend deployments

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT="${1:-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo -e "${GREEN}🚀 Building Frontend Docker Image for environment: $ENVIRONMENT${NC}"

# Check AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured. Please run 'aws configure'.${NC}"
    exit 1
fi

# Fetch OAuth credentials from AWS Secrets Manager
echo -e "${YELLOW}Fetching OAuth credentials from AWS Secrets Manager...${NC}"
SECRET_NAME="postolio/app-secrets/$ENVIRONMENT"

# Get the full secret JSON
SECRET_JSON=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_NAME" \
    --query 'SecretString' \
    --output text \
    --region $AWS_REGION 2>/dev/null || echo "{}")

# Function to extract a value from the secrets JSON
extract_json_value() {
    local json="$1"
    local key="$2"
    echo "$json" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('$key', ''))" 2>/dev/null || echo ""
}

# Extract OAuth credentials
GOOGLE_CLIENT_ID=$(extract_json_value "$SECRET_JSON" "googleClientId")
FACEBOOK_APP_ID=$(extract_json_value "$SECRET_JSON" "facebookAppId")

if [ -z "$GOOGLE_CLIENT_ID" ]; then
    echo -e "${YELLOW}⚠️  Google Client ID not found in Secrets Manager${NC}"
    echo -e "${YELLOW}Google Sign-In will be disabled in the frontend${NC}"
else
    echo -e "${GREEN}✅ Google Client ID retrieved successfully${NC}"
fi

if [ -z "$FACEBOOK_APP_ID" ]; then
    echo -e "${YELLOW}⚠️  Facebook App ID not found in Secrets Manager${NC}"
    echo -e "${YELLOW}Facebook Sign-In will be disabled in the frontend${NC}"
else
    echo -e "${GREEN}✅ Facebook App ID retrieved successfully${NC}"
fi

# Determine API URL based on environment
if [ "$ENVIRONMENT" = "prod" ]; then
    API_URL="https://postolio.example"
else
    # For dev/staging, you might want to customize this
    API_URL="https://postolio.example"
fi

echo -e "${YELLOW}Building frontend Docker image...${NC}"
echo -e "${YELLOW}API URL: $API_URL${NC}"

# Use the monorepo web package directory
cd "$PROJECT_ROOT/packages/apps/web"

# Build Docker image with build arguments
BUILD_ARGS="--build-arg VITE_API_URL=$API_URL"

if [ -n "$GOOGLE_CLIENT_ID" ]; then
    echo -e "${GREEN}✅ Building with Google OAuth enabled${NC}"
    BUILD_ARGS="$BUILD_ARGS --build-arg VITE_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
else
    echo -e "${YELLOW}⚠️  Building without Google OAuth${NC}"
fi

if [ -n "$FACEBOOK_APP_ID" ]; then
    echo -e "${GREEN}✅ Building with Facebook OAuth enabled${NC}"
    BUILD_ARGS="$BUILD_ARGS --build-arg VITE_FACEBOOK_APP_ID=$FACEBOOK_APP_ID"
else
    echo -e "${YELLOW}⚠️  Building without Facebook OAuth${NC}"
fi

echo -e "${YELLOW}Building Docker image with OAuth credentials...${NC}"
docker build \
    $BUILD_ARGS \
    -t "postolio-frontend:$ENVIRONMENT" \
    -f Dockerfile .

echo -e "${GREEN}✅ Frontend Docker image built successfully${NC}"
echo -e "${GREEN}Image tagged as: postolio-frontend:$ENVIRONMENT${NC}"

# Optional: Push to ECR if needed
read -p "Do you want to push this image to ECR? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    ECR_REGISTRY_URL="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
    
    # Login to ECR
    echo -e "${YELLOW}Logging in to ECR...${NC}"
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY_URL
    
    # Create repository if it doesn't exist
    aws ecr describe-repositories --repository-names postolio-frontend --region $AWS_REGION &> /dev/null || \
        aws ecr create-repository --repository-name postolio-frontend --region $AWS_REGION
    
    # Tag and push
    IMAGE_URI="$ECR_REGISTRY_URL/postolio-frontend:$ENVIRONMENT"
    docker tag "postolio-frontend:$ENVIRONMENT" "$IMAGE_URI"
    
    echo -e "${YELLOW}Pushing to $IMAGE_URI...${NC}"
    docker push "$IMAGE_URI"
    
    echo -e "${GREEN}✅ Image pushed to ECR successfully${NC}"
fi
