#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ENVIRONMENT=${1:-dev}
AWS_REGION=${AWS_REGION:-us-east-1}

echo -e "${GREEN}Setting up OAuth secrets for Postolio ($ENVIRONMENT)${NC}"
echo "================================================"

# Check if required environment variables are set
if [ -z "$GOOGLE_CLIENT_ID" ]; then
    echo -e "${YELLOW}Enter your Google Client ID (from Google Cloud Console):${NC}"
    read -r GOOGLE_CLIENT_ID
fi

if [ -z "$GOOGLE_CLIENT_SECRET" ]; then
    echo -e "${YELLOW}Enter your Google Client Secret:${NC}"
    read -r -s GOOGLE_CLIENT_SECRET
    echo
fi

if [ -z "$FACEBOOK_APP_ID" ]; then
    echo -e "${YELLOW}Enter your Facebook App ID (optional, press Enter to skip):${NC}"
    read -r FACEBOOK_APP_ID
fi

if [ -z "$FACEBOOK_APP_SECRET" ]; then
    echo -e "${YELLOW}Enter your Facebook App Secret (optional, press Enter to skip):${NC}"
    read -r -s FACEBOOK_APP_SECRET
    echo
fi

# Create or update the secret
SECRET_NAME="postolio/app-secrets/$ENVIRONMENT"

echo -e "${YELLOW}Creating/updating secret: $SECRET_NAME${NC}"

# Build the secret JSON
SECRET_JSON=$(cat <<EOF
{
  "googleClientId": "$GOOGLE_CLIENT_ID",
  "googleClientSecret": "$GOOGLE_CLIENT_SECRET",
  "facebookAppId": "${FACEBOOK_APP_ID:-}",
  "facebookAppSecret": "${FACEBOOK_APP_SECRET:-}"
}
EOF
)

# Check if secret exists
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$AWS_REGION" &> /dev/null; then
    echo -e "${YELLOW}Secret exists, updating...${NC}"
    aws secretsmanager update-secret \
        --secret-id "$SECRET_NAME" \
        --secret-string "$SECRET_JSON" \
        --region "$AWS_REGION"
else
    echo -e "${YELLOW}Creating new secret...${NC}"
    aws secretsmanager create-secret \
        --name "$SECRET_NAME" \
        --description "OAuth credentials for Postolio $ENVIRONMENT" \
        --secret-string "$SECRET_JSON" \
        --region "$AWS_REGION"
fi

echo -e "${GREEN}✅ OAuth secrets configured successfully!${NC}"
echo ""
echo "Next steps:"
echo "1. Rebuild and push the Docker image:"
echo "   ./scripts/deploy-aws.sh"
echo ""
echo "2. Or if you just want to update the ECS service:"
echo "   aws ecs update-service --cluster Postolio-$ENVIRONMENT-PostolioCluster* --service Postolio-$ENVIRONMENT-PostolioService* --force-new-deployment"