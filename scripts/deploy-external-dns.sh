#!/bin/bash

# Deployment script for custom domains NOT hosted on Route 53
# This script deploys with external DNS provider configuration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Deploying Postolio with External DNS Provider${NC}"
echo

# Check if domain name is provided
if [ -z "$DOMAIN_NAME" ]; then
    echo -e "${RED}❌ DOMAIN_NAME environment variable is required.${NC}"
    echo "Please set it before running this script:"
    echo
    echo "export DOMAIN_NAME=\"postolio.example\""
    echo
    exit 1
fi

# Set configuration
export USE_EXTERNAL_DNS=true
export AWS_REGION=${AWS_REGION:-us-east-1}
ENVIRONMENT=${1:-prod}

echo -e "${YELLOW}Configuration:${NC}"
echo "Domain: $DOMAIN_NAME"
echo "DNS Provider: External (not Route 53)"
echo "Environment: $ENVIRONMENT"
echo "AWS Region: $AWS_REGION"
echo

# Important warnings for external DNS
echo -e "${YELLOW}⚠️  Important Notes for External DNS:${NC}"
echo "1. SSL certificate will use email validation"
echo "2. You'll receive validation emails at admin@/webmaster@ your root domain"
echo "3. You must create DNS records manually after deployment"
echo "4. DNS propagation can take up to 48 hours"
echo

# Confirm deployment
echo -e "${YELLOW}This will deploy the Postolio application with:${NC}"
echo "• Custom domain: $DOMAIN_NAME (external DNS)"
echo "• SSL certificate (email validation required)"
echo "• Production infrastructure (RDS, ECS, CloudFront, etc.)"
echo "• Manual DNS configuration required"
echo

read -p "Continue with external DNS deployment? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Deployment cancelled."
    exit 1
fi

# Run the main deployment script
echo -e "${GREEN}Starting deployment...${NC}"
exec "$(dirname "$0")/deploy-aws.sh" "$ENVIRONMENT" deploy
