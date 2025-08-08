#!/bin/bash

# Quick deployment script for postolio.example production environment
# This script sets up the production environment with the custom domain

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Deploying Postolio to postolio.example${NC}"
echo

# Check if hosted zone ID is provided
if [ -z "$HOSTED_ZONE_ID" ]; then
    echo -e "${YELLOW}⚠️  HOSTED_ZONE_ID environment variable not set.${NC}"
    echo "Please set it before running this script:"
    echo
    echo "1. Get your hosted zone ID from Route 53:"
    echo "   aws route53 list-hosted-zones-by-name --dns-name postolio.example --query 'HostedZones[0].Id' --output text | sed 's|/hostedzone/||'"
    echo
    echo "2. Export the hosted zone ID:"
    echo "   export HOSTED_ZONE_ID=\"YOUR_HOSTED_ZONE_ID\""
    echo
    echo "3. Run this script again"
    echo
    exit 1
fi

# Set domain configuration
export DOMAIN_NAME="postolio.example"
export AWS_REGION=${AWS_REGION:-us-east-1}

echo -e "${YELLOW}Configuration:${NC}"
echo "Domain: $DOMAIN_NAME"
echo "Hosted Zone ID: $HOSTED_ZONE_ID"
echo "AWS Region: $AWS_REGION"
echo

# Confirm deployment
echo -e "${YELLOW}This will deploy the Postolio application to production with the following:${NC}"
echo "• Custom domain: $DOMAIN_NAME"
echo "• SSL certificate (automatically provisioned)"
echo "• Production infrastructure (RDS, ECS, CloudFront, etc.)"
echo "• Estimated monthly cost: $200-500"
echo
read -p "Continue with production deployment? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Deployment cancelled."
    exit 1
fi

# Run the main deployment script
exec "$(dirname "$0")/deploy-aws.sh" prod deploy
