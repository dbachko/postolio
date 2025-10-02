#!/bin/bash

# Get Application URLs from Stack-Based Deployment
# Retrieves URLs and resource information from multiple CDK stacks

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default environment
ENVIRONMENT="${1:-dev}"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🔍 Postolio Application URLs${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Environment: $ENVIRONMENT${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Function to get stack output
get_output() {
    local stack_name="$1"
    local output_key="$2"
    aws cloudformation describe-stacks --stack-name "$stack_name" \
        --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
        --output text 2>/dev/null || echo ""
}

# Function to check stack status
check_stack() {
    local stack_name="$1"
    aws cloudformation describe-stacks --stack-name "$stack_name" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "NOT_FOUND"
}

# Define stack names
FOUNDATION_STACK="Postolio-Foundation-$ENVIRONMENT"
API_STACK="Postolio-API-$ENVIRONMENT"
WEB_STACK="Postolio-Web-$ENVIRONMENT"

# Check Foundation stack
FOUNDATION_STATUS=$(check_stack "$FOUNDATION_STACK")
if [[ "$FOUNDATION_STATUS" == "NOT_FOUND" ]]; then
    echo -e "${YELLOW}⚠️  Foundation stack not found. Have you deployed yet?${NC}"
    echo -e "${YELLOW}   Run: ./scripts/deploy-stack.sh foundation${NC}"
    exit 1
fi

# Check API stack
API_STATUS=$(check_stack "$API_STACK")
if [[ "$API_STATUS" == "NOT_FOUND" ]]; then
    echo -e "${YELLOW}⚠️  API stack not found${NC}"
fi

# Check Web stack
WEB_STATUS=$(check_stack "$WEB_STACK")
if [[ "$WEB_STATUS" == "NOT_FOUND" ]]; then
    echo -e "${YELLOW}⚠️  Web stack not found${NC}"
fi

echo -e "${GREEN}📱 APPLICATION URLS${NC}"
echo "==================="

# Get Web URLs
if [[ "$WEB_STATUS" != "NOT_FOUND" ]]; then
    CLOUDFRONT_URL=$(get_output "$WEB_STACK" "CloudFrontURL")
    FRONTEND_BUCKET=$(get_output "$WEB_STACK" "FrontendBucketName")

    if [[ -n "$CLOUDFRONT_URL" ]]; then
        echo -e "🌐 Frontend:         ${GREEN}$CLOUDFRONT_URL${NC}"
    fi
else
    echo "🌐 Frontend:         Not deployed"
fi

# Get API URLs
if [[ "$API_STATUS" != "NOT_FOUND" ]]; then
    BACKEND_URL=$(get_output "$API_STACK" "LoadBalancerURL")
    ALB_DNS=$(get_output "$API_STACK" "LoadBalancerDNS")

    if [[ -n "$BACKEND_URL" ]]; then
        echo -e "🚀 Backend API:      ${GREEN}$BACKEND_URL${NC}"
        echo -e "💊 Health Check:     ${GREEN}$BACKEND_URL/api/health${NC}"
    elif [[ -n "$ALB_DNS" ]]; then
        echo -e "🚀 Backend API:      ${GREEN}http://$ALB_DNS${NC}"
        echo -e "💊 Health Check:     ${GREEN}http://$ALB_DNS/api/health${NC}"
    fi
else
    echo "🚀 Backend API:      Not deployed"
fi

echo
echo -e "${GREEN}📊 USEFUL ENDPOINTS${NC}"
echo "===================="

if [[ "$API_STATUS" != "NOT_FOUND" ]] && [[ -n "$BACKEND_URL" || -n "$ALB_DNS" ]]; then
    BASE_URL="${BACKEND_URL:-http://$ALB_DNS}"
    echo "Auth Login:         $BASE_URL/api/auth/login"
    echo "Auth Register:      $BASE_URL/api/auth/register"
    echo "Brands:             $BASE_URL/api/brands/list"
    echo "Campaigns:          $BASE_URL/api/campaign/list"
    echo "Instagram OAuth:    $BASE_URL/api/auth/instagram/authorize"
else
    echo "API not deployed yet"
fi

echo
echo -e "${GREEN}🔧 AWS RESOURCES${NC}"
echo "================="

# Get Foundation resources
if [[ "$FOUNDATION_STATUS" != "NOT_FOUND" ]]; then
    DATABASE_ENDPOINT=$(get_output "$FOUNDATION_STACK" "DatabaseEndpoint")
    REDIS_ENDPOINT=$(get_output "$FOUNDATION_STACK" "CacheEndpoint")
    ECR_REPO=$(get_output "$FOUNDATION_STACK" "EcrRepositoryUri")
    VPC_ID=$(get_output "$FOUNDATION_STACK" "VpcId")
    IMAGES_CDN=$(get_output "$FOUNDATION_STACK" "ImagesCdnDomain")

    echo "Database:           ${DATABASE_ENDPOINT:-Not found}"
    echo "Redis:              ${REDIS_ENDPOINT:-Not found}"
    echo "ECR Repository:     ${ECR_REPO:-Not found}"
    echo "VPC ID:             ${VPC_ID:-Not found}"
    echo "Images CDN:         ${IMAGES_CDN:-Not found}"
fi

# Get Web resources
if [[ "$WEB_STATUS" != "NOT_FOUND" ]]; then
    echo "S3 Bucket:          ${FRONTEND_BUCKET:-Not found}"
fi

echo
echo -e "${GREEN}📦 STACK STATUS${NC}"
echo "==============="
echo "Foundation:         $FOUNDATION_STATUS"
echo "API:                $API_STATUS"
echo "Web:                $WEB_STATUS"

echo
if [[ "$WEB_STATUS" == *"COMPLETE" ]] && [[ "$API_STATUS" == *"COMPLETE" ]]; then
    echo -e "${GREEN}✅ All stacks deployed successfully!${NC}"
    echo -e "${GREEN}🚀 Open the frontend URL in your browser to get started.${NC}"
elif [[ "$API_STATUS" == *"IN_PROGRESS" ]] || [[ "$WEB_STATUS" == *"IN_PROGRESS" ]]; then
    echo -e "${YELLOW}⏳ Deployment in progress. Check back in a few minutes.${NC}"
else
    echo -e "${YELLOW}⚠️  Some stacks are not deployed yet.${NC}"
    echo -e "${YELLOW}   Run: ./scripts/deploy-stack.sh all${NC}"
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
