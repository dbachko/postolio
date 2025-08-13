#!/bin/bash

# Frontend-only deployment script for Postolio
# Use this when you only need to update the frontend without redeploying infrastructure

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-dev}
AWS_REGION=${AWS_REGION:-us-east-1}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo -e "${GREEN}🚀 Starting frontend deployment for environment: $ENVIRONMENT${NC}"

# Check requirements
check_requirements() {
    echo -e "${YELLOW}Checking requirements...${NC}"
    
    if ! command -v aws &> /dev/null; then
        echo -e "${RED}❌ AWS CLI is not installed${NC}"
        exit 1
    fi
    
    if ! aws sts get-caller-identity &> /dev/null; then
        echo -e "${RED}❌ AWS credentials not configured${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Requirements met${NC}"
}

# Deploy frontend
deploy_frontend() {
    echo -e "${YELLOW}Deploying frontend...${NC}"
    cd "$PROJECT_ROOT/frontend"
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}Installing frontend dependencies...${NC}"
        npm install
    fi
    
    # Use unified domain architecture - frontend and backend share postolio.example
    # Check if custom domain is configured
    API_URL=$(aws cloudformation describe-stacks \
        --stack-name Postolio-$ENVIRONMENT \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
        --output text \
        --region $AWS_REGION 2>/dev/null)
    
    if [ -z "$API_URL" ] || [ "$API_URL" = "None" ]; then
        # Fallback to ALB DNS for environments without custom domain
        LOAD_BALANCER_DNS=$(aws cloudformation describe-stacks \
            --stack-name Postolio-$ENVIRONMENT \
            --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
            --output text \
            --region $AWS_REGION)
        
        if [ -z "$LOAD_BALANCER_DNS" ] || [ "$LOAD_BALANCER_DNS" = "None" ]; then
            echo -e "${RED}❌ Could not find API endpoint in stack outputs${NC}"
            exit 1
        fi
        
        API_URL="https://$LOAD_BALANCER_DNS"
        echo -e "${YELLOW}Using ALB DNS: $API_URL${NC}"
    else
        # For unified domain, use https://postolio.example
        API_URL="https://postolio.example"
        echo -e "${GREEN}Using unified domain: $API_URL${NC}"
    fi
    
    # Create production environment file
    echo "VITE_API_BASE_URL=$API_URL" > .env.production
    echo -e "${GREEN}✅ Created .env.production with API URL: $API_URL${NC}"
    
    # Build frontend
    echo -e "${YELLOW}Building frontend...${NC}"
    if ! npm run build; then
        echo -e "${RED}❌ Frontend build failed${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Frontend built successfully${NC}"
    
    # Verify dist folder exists
    if [ ! -d "dist" ]; then
        echo -e "${RED}❌ Build output directory 'dist' not found${NC}"
        exit 1
    fi
    
    # Get S3 bucket name from the stack
    BUCKET_NAME=$(aws cloudformation describe-stacks \
        --stack-name Postolio-$ENVIRONMENT \
        --query 'Stacks[0].Outputs[?OutputKey==`FrontendBucketName`].OutputValue' \
        --output text \
        --region $AWS_REGION)
    
    if [ -z "$BUCKET_NAME" ] || [ "$BUCKET_NAME" = "None" ]; then
        echo -e "${RED}❌ Frontend S3 bucket not found in stack outputs${NC}"
        echo "Make sure the infrastructure is deployed first"
        exit 1
    fi
    
    # Upload to S3
    echo -e "${YELLOW}Uploading frontend to S3 bucket: $BUCKET_NAME${NC}"
    if ! aws s3 sync dist s3://$BUCKET_NAME --delete --region $AWS_REGION; then
        echo -e "${RED}❌ Failed to upload frontend to S3${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Frontend uploaded to S3${NC}"
    
    # Invalidate CloudFront cache - get distribution ID from stack outputs
    DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
        --stack-name Postolio-$ENVIRONMENT \
        --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
        --output text \
        --region $AWS_REGION)
    
    if [ -n "$DISTRIBUTION_ID" ] && [ "$DISTRIBUTION_ID" != "None" ]; then
        echo -e "${YELLOW}Invalidating CloudFront cache (Distribution: $DISTRIBUTION_ID)...${NC}"
        INVALIDATION_ID=$(aws cloudfront create-invalidation \
            --distribution-id $DISTRIBUTION_ID \
            --paths "/*" \
            --query 'Invalidation.Id' \
            --output text)
        echo -e "${GREEN}✅ CloudFront cache invalidation started (ID: $INVALIDATION_ID)${NC}"
    else
        echo -e "${YELLOW}⚠️  CloudFront distribution not found, skipping cache invalidation${NC}"
    fi
}

# Show deployment info
show_info() {
    echo
    echo -e "${GREEN}🎉 Frontend deployment completed successfully!${NC}"
    echo
    
    # Get the application URL
    APP_URL=$(aws cloudformation describe-stacks \
        --stack-name Postolio-$ENVIRONMENT \
        --query 'Stacks[0].Outputs[?OutputKey==`ApplicationURL`].OutputValue' \
        --output text \
        --region $AWS_REGION 2>/dev/null)
    
    if [ -z "$APP_URL" ] || [ "$APP_URL" = "None" ]; then
        # Try CloudFront distribution domain
        CF_DOMAIN=$(aws cloudformation describe-stacks \
            --stack-name Postolio-$ENVIRONMENT \
            --query 'Stacks[0].Outputs[?OutputKey==`FrontendDistributionDomainName`].OutputValue' \
            --output text \
            --region $AWS_REGION 2>/dev/null)
        
        if [ -n "$CF_DOMAIN" ] && [ "$CF_DOMAIN" != "None" ]; then
            APP_URL="https://$CF_DOMAIN"
        else
            APP_URL="https://postolio.example"
        fi
    fi
    
    echo -e "${GREEN}🌐 Application URL: $APP_URL${NC}"
    echo
    echo -e "${YELLOW}Note:${NC} CloudFront cache invalidation may take a few minutes to complete."
    echo "You can check the status with:"
    echo "  aws cloudfront get-invalidation --distribution-id $DISTRIBUTION_ID --id <invalidation-id>"
}

# Main execution
main() {
    check_requirements
    deploy_frontend
    show_info
}

main