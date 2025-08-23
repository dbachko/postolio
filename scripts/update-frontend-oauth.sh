#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔄 Updating frontend with Google and Facebook OAuth credentials...${NC}"

# Configuration
ENVIRONMENT="dev"
AWS_REGION="us-east-1"

# Retrieve OAuth credentials from environment variables
if [ -z "$GOOGLE_CLIENT_ID" ]; then
    echo -e "${RED}❌ GOOGLE_CLIENT_ID environment variable is not set.${NC}"
    echo -e "${YELLOW}💡 Set it with: export GOOGLE_CLIENT_ID=your-google-client-id${NC}"
    exit 1
fi

if [ -z "$FACEBOOK_APP_ID" ]; then
    echo -e "${RED}❌ FACEBOOK_APP_ID environment variable is not set.${NC}"
    echo -e "${YELLOW}💡 Set it with: export FACEBOOK_APP_ID=your-facebook-app-id${NC}"
    exit 1
fi

# Get project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Navigate to frontend directory
cd "$PROJECT_ROOT/frontend"

# Create production environment file
echo -e "${YELLOW}📝 Creating production environment file...${NC}"
cat > .env.production << EOF
VITE_API_BASE_URL=https://postolio.example
VITE_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
VITE_FACEBOOK_APP_ID=$FACEBOOK_APP_ID
EOF

echo -e "${GREEN}✅ Environment file created with Google and Facebook credentials${NC}"

# Build frontend
echo -e "${YELLOW}🔨 Building frontend...${NC}"
if ! npm run build; then
    echo -e "${RED}❌ Frontend build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Frontend built successfully${NC}"

# Get S3 bucket name from CloudFormation stack
echo -e "${YELLOW}🔍 Finding S3 bucket...${NC}"
BUCKET_NAME=$(aws cloudformation describe-stacks \
    --stack-name Postolio-$ENVIRONMENT \
    --query 'Stacks[0].Outputs[?OutputKey==`FrontendBucketName`].OutputValue' \
    --output text \
    --region $AWS_REGION 2>/dev/null || echo "")

if [ -z "$BUCKET_NAME" ] || [ "$BUCKET_NAME" = "None" ]; then
    # Try alternative bucket name
    BUCKET_NAME="postolio-frontend-dev-000000000000"
    echo -e "${YELLOW}Using alternative bucket name: $BUCKET_NAME${NC}"
fi

# Upload to S3
echo -e "${YELLOW}📤 Uploading to S3 bucket: $BUCKET_NAME${NC}"
aws s3 sync dist/ s3://$BUCKET_NAME/ \
    --delete \
    --region $AWS_REGION \
    --cache-control "public, max-age=31536000" \
    --exclude "index.html" \
    --exclude "*.json"

# Upload index.html and JSON files with no-cache
aws s3 cp dist/index.html s3://$BUCKET_NAME/index.html \
    --region $AWS_REGION \
    --cache-control "no-cache, no-store, must-revalidate" \
    --content-type "text/html"

aws s3 sync dist/ s3://$BUCKET_NAME/ \
    --region $AWS_REGION \
    --cache-control "no-cache, no-store, must-revalidate" \
    --exclude "*" \
    --include "*.json"

echo -e "${GREEN}✅ Frontend uploaded to S3${NC}"

# Get CloudFront distribution ID
echo -e "${YELLOW}🔍 Finding CloudFront distribution...${NC}"
DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
    --stack-name Postolio-$ENVIRONMENT \
    --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
    --output text \
    --region $AWS_REGION 2>/dev/null || echo "")

if [ -z "$DISTRIBUTION_ID" ] || [ "$DISTRIBUTION_ID" = "None" ]; then
    # Try to find it from CloudFront distributions
    DISTRIBUTION_ID=$(aws cloudfront list-distributions \
        --query "DistributionList.Items[?contains(Origins.Items[0].DomainName, 'postolio-frontend')].Id | [0]" \
        --output text \
        --region $AWS_REGION 2>/dev/null || echo "")
fi

if [ -n "$DISTRIBUTION_ID" ] && [ "$DISTRIBUTION_ID" != "None" ]; then
    echo -e "${YELLOW}🔄 Creating CloudFront invalidation for distribution: $DISTRIBUTION_ID${NC}"
    aws cloudfront create-invalidation \
        --distribution-id $DISTRIBUTION_ID \
        --paths "/*" \
        --region $AWS_REGION > /dev/null
    echo -e "${GREEN}✅ CloudFront cache invalidated${NC}"
else
    echo -e "${YELLOW}⚠️  CloudFront distribution not found - cache not invalidated${NC}"
fi

echo -e "${GREEN}✅ Frontend update complete!${NC}"
echo -e "${GREEN}Both Google and Facebook OAuth buttons should now work on https://postolio.example${NC}"
echo ""
echo -e "${YELLOW}⚠️  Important: Make sure to update your OAuth providers:${NC}"
echo -e "${YELLOW}1. Google Cloud Console: Add https://postolio.example to Authorized JavaScript origins${NC}"
echo -e "${YELLOW}2. Facebook Developers: Add https://postolio.example to Valid OAuth Redirect URIs${NC}"