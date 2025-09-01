#!/bin/bash

# Test script to verify secrets configuration before deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Postolio Secrets Configuration Test ===${NC}"
echo ""

# Check environment
ENVIRONMENT="${1:-dev}"
echo -e "${YELLOW}Environment:${NC} $ENVIRONMENT"
echo ""

# Track issues
ISSUES_FOUND=0

# Check required user secrets
echo -e "${YELLOW}Checking User Secrets (Environment Variables):${NC}"
echo ""

# OpenAI API Key (Required)
if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${RED}❌ OPENAI_API_KEY not set (REQUIRED)${NC}"
    echo "   This is required for AI content generation"
    echo "   Set it with: export OPENAI_API_KEY='sk-...'"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
    if [[ "$OPENAI_API_KEY" == "sk-"* ]]; then
        echo -e "${GREEN}✅ OPENAI_API_KEY is set and appears valid${NC}"
    else
        echo -e "${YELLOW}⚠️  OPENAI_API_KEY is set but doesn't start with 'sk-'${NC}"
    fi
fi

# Google Client Secret (Optional)
if [ -z "$GOOGLE_CLIENT_SECRET" ]; then
    echo -e "${YELLOW}⚠️  GOOGLE_CLIENT_SECRET not set (optional)${NC}"
    echo "   Required only if using Google OAuth"
else
    echo -e "${GREEN}✅ GOOGLE_CLIENT_SECRET is set${NC}"
fi

# Facebook App Secret (Optional)
if [ -z "$FACEBOOK_APP_SECRET" ]; then
    echo -e "${YELLOW}⚠️  FACEBOOK_APP_SECRET not set (optional)${NC}"
    echo "   Required only if using Facebook/Instagram OAuth"
else
    echo -e "${GREEN}✅ FACEBOOK_APP_SECRET is set${NC}"
fi

echo ""
echo -e "${YELLOW}Infrastructure Secrets (Auto-generated):${NC}"
echo ""
echo -e "${GREEN}✅ JWT_SECRET${NC} - Will be generated from stack ID"
echo -e "${GREEN}✅ REDIS_URL${NC} - Will be configured from ElastiCache endpoint"
echo -e "${GREEN}✅ DB_USERNAME/PASSWORD${NC} - Managed by RDS"

# Check if .env file exists
echo ""
if [ -f ".env" ]; then
    echo -e "${YELLOW}📄 Found .env file${NC}"
    echo "   You can source it before deployment: source .env"
    
    # Check if .env contains the required keys
    if grep -q "OPENAI_API_KEY" .env 2>/dev/null; then
        echo -e "${GREEN}   ✅ .env contains OPENAI_API_KEY${NC}"
    fi
else
    echo -e "${YELLOW}📄 No .env file found${NC}"
    echo "   You can create one to store your secrets"
fi

# Check AWS credentials
echo ""
echo -e "${YELLOW}Checking AWS Configuration:${NC}"
echo ""

if aws sts get-caller-identity >/dev/null 2>&1; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    REGION="${AWS_REGION:-us-east-1}"
    echo -e "${GREEN}✅ AWS credentials configured${NC}"
    echo "   Account: $ACCOUNT_ID"
    echo "   Region: $REGION"
else
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    echo "   Run: aws configure"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi

# Summary
echo ""
echo -e "${YELLOW}=== Summary ===${NC}"
echo ""

if [ $ISSUES_FOUND -eq 0 ]; then
    echo -e "${GREEN}✅ All required configurations are in place!${NC}"
    echo ""
    echo "You can now deploy with:"
    echo "  ./scripts/deploy-aws.sh $ENVIRONMENT"
else
    echo -e "${RED}❌ Found $ISSUES_FOUND issue(s) that need to be resolved${NC}"
    echo ""
    echo "Fix the issues above, then run this test again:"
    echo "  ./scripts/test-secrets-config.sh $ENVIRONMENT"
fi

echo ""
echo -e "${YELLOW}CDK Deployment Command Preview:${NC}"
echo "npx cdk deploy Postolio-$ENVIRONMENT \\"
echo "  --context openaiApiKey=\"\${OPENAI_API_KEY:-}\" \\"
echo "  --context googleClientSecret=\"\${GOOGLE_CLIENT_SECRET:-}\" \\"
echo "  --context facebookAppSecret=\"\${FACEBOOK_APP_SECRET:-}\""