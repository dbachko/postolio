#!/bin/bash

# Setup Frontend Environment Variables from AWS Secrets Manager
# This script fetches secrets from AWS and creates .env files for local development

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

echo -e "${GREEN}🔧 Setting up frontend environment for: $ENVIRONMENT${NC}"

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

# Fetch secrets from AWS Secrets Manager
echo -e "${YELLOW}Fetching secrets from AWS Secrets Manager...${NC}"
SECRET_NAME="postolio/app-secrets/$ENVIRONMENT"

SECRET_JSON=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_NAME" \
    --query 'SecretString' \
    --output text \
    --region $AWS_REGION 2>/dev/null)

if [ -z "$SECRET_JSON" ]; then
    echo -e "${RED}❌ Failed to fetch secrets from AWS Secrets Manager${NC}"
    echo -e "${YELLOW}Make sure the secret '$SECRET_NAME' exists in region $AWS_REGION${NC}"
    exit 1
fi

# Function to extract a value from the secrets JSON
extract_json_value() {
    local json="$1"
    local key="$2"
    echo "$json" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('$key', ''))" 2>/dev/null || echo ""
}

# Parse the JSON to get individual values
GOOGLE_CLIENT_ID=$(extract_json_value "$SECRET_JSON" "googleClientId")
FACEBOOK_APP_ID=$(extract_json_value "$SECRET_JSON" "facebookAppId")

# Determine API URL based on environment
if [ "$ENVIRONMENT" = "prod" ]; then
    API_URL="https://postolio.example"
elif [ "$ENVIRONMENT" = "dev" ]; then
    API_URL="http://localhost:3000"
else
    API_URL="https://postolio.example"
fi

# Create frontend .env file
FRONTEND_ENV_FILE="$PROJECT_ROOT/frontend/.env.$ENVIRONMENT"
echo -e "${YELLOW}Creating $FRONTEND_ENV_FILE...${NC}"

cat > "$FRONTEND_ENV_FILE" << EOF
# Generated from AWS Secrets Manager on $(date)
# Environment: $ENVIRONMENT

VITE_API_BASE_URL=$API_URL
EOF

# Add Google Client ID if available
if [ -n "$GOOGLE_CLIENT_ID" ]; then
    echo "VITE_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" >> "$FRONTEND_ENV_FILE"
    echo -e "${GREEN}✅ Google OAuth configured${NC}"
else
    echo "# VITE_GOOGLE_CLIENT_ID not configured in AWS Secrets Manager" >> "$FRONTEND_ENV_FILE"
    echo -e "${YELLOW}⚠️  Google OAuth not configured${NC}"
fi

# Add Facebook App ID if available
if [ -n "$FACEBOOK_APP_ID" ]; then
    echo "VITE_FACEBOOK_APP_ID=$FACEBOOK_APP_ID" >> "$FRONTEND_ENV_FILE"
    echo -e "${GREEN}✅ Facebook OAuth configured${NC}"
else
    echo "# VITE_FACEBOOK_APP_ID not configured in AWS Secrets Manager" >> "$FRONTEND_ENV_FILE"
    echo -e "${YELLOW}⚠️  Facebook OAuth not configured${NC}"
fi

echo -e "${GREEN}✅ Frontend environment file created: $FRONTEND_ENV_FILE${NC}"

# For local development, also create .env.local if in dev mode
if [ "$ENVIRONMENT" = "dev" ]; then
    FRONTEND_LOCAL_ENV="$PROJECT_ROOT/frontend/.env.local"
    cp "$FRONTEND_ENV_FILE" "$FRONTEND_LOCAL_ENV"
    echo -e "${GREEN}✅ Also created .env.local for local development${NC}"
fi

echo -e "${GREEN}✨ Frontend environment setup complete!${NC}"
echo ""
echo "You can now run:"
echo "  cd frontend && npm run dev    # For development"
echo "  cd frontend && npm run build  # For production build"