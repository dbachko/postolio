#!/bin/bash
# Quick start script for local AWS deployment testing
set -e

echo "🚀 Postolio - Quick AWS Setup"
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if AWS CLI is configured
check_aws_config() {
    if ! aws sts get-caller-identity &> /dev/null; then
        echo -e "${RED}❌ AWS CLI not configured. Please run 'aws configure' first.${NC}"
        echo
        echo "You'll need:"
        echo "- AWS Access Key ID"
        echo "- AWS Secret Access Key"
        echo "- Default region (e.g., us-east-1)"
        echo "- Default output format (json)"
        exit 1
    fi
    
    echo -e "${GREEN}✅ AWS CLI configured${NC}"
}

# Install CDK dependencies
setup_cdk() {
    echo -e "${YELLOW}Setting up CDK dependencies...${NC}"
    cd aws-infrastructure
    npm install
    cd ..
}

# Show required environment variables
show_required_secrets() {
    echo -e "${YELLOW}📋 Required Secrets Configuration${NC}"
    echo "After deployment, you'll need to update these secrets in AWS Secrets Manager:"
    echo
    echo "1. OpenAI API Key - Get from https://platform.openai.com/api-keys"
    echo "2. Facebook App ID - Get from https://developers.facebook.com/"
    echo "3. Facebook App Secret - Get from https://developers.facebook.com/"
    echo
    echo "The deployment script will show you the exact ARN to update."
    echo
}

# Main setup
main() {
    echo "This script will help you deploy Postolio to AWS."
    echo "Make sure you have Docker running and AWS CLI configured."
    echo
    
    # Confirm deployment
    echo -e "${YELLOW}Do you want to deploy to development environment? (y/n)${NC}"
    read -r response
    
    if [[ "$response" != "y" && "$response" != "Y" ]]; then
        echo "Deployment cancelled."
        exit 0
    fi
    
    check_aws_config
    setup_cdk
    show_required_secrets
    
    echo -e "${GREEN}🎯 Starting deployment...${NC}"
    ./scripts/deploy-aws.sh dev
}

main
