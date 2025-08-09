#!/bin/bash

# Postolio AWS Setup Validation Script
# This script helps verify your AWS configuration before attempting deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 Postolio AWS Setup Validation${NC}"
echo "================================"
echo

# Check if AWS CLI is installed
check_aws_cli() {
    if ! command -v aws &> /dev/null; then
        echo -e "${RED}❌ AWS CLI is not installed${NC}"
        echo "Install AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
        return 1
    else
        echo -e "${GREEN}✅ AWS CLI is installed${NC}"
        aws --version
        return 0
    fi
}

# Check AWS credentials configuration
check_aws_credentials() {
    if ! aws sts get-caller-identity &> /dev/null; then
        echo -e "${RED}❌ AWS credentials are not configured${NC}"
        echo "Run: aws configure"
        echo "You'll need:"
        echo "- AWS Access Key ID"
        echo "- AWS Secret Access Key"
        echo "- Default region (recommended: us-east-1)"
        echo "- Default output format (recommended: json)"
        return 1
    else
        echo -e "${GREEN}✅ AWS credentials are configured${NC}"
        
        # Get account info
        ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
        USER_ARN=$(aws sts get-caller-identity --query Arn --output text)
        REGION=$(aws configure get region || echo "not set")
        
        echo "Account ID: $ACCOUNT_ID"
        echo "User/Role: $USER_ARN"
        echo "Region: $REGION"
        
        # Export account ID for GitHub secrets
        echo
        echo -e "${YELLOW}📋 GitHub Secrets Configuration:${NC}"
        echo "Add these secrets to your GitHub repository (Settings > Secrets and variables > Actions):"
        echo
        echo "AWS_ACCESS_KEY_ID: [Your IAM user access key]"
        echo "AWS_SECRET_ACCESS_KEY: [Your IAM user secret key]" 
        echo "AWS_ACCOUNT_ID: $ACCOUNT_ID"
        echo
        
        return 0
    fi
}

# Check required permissions for deployment
check_permissions() {
    echo -e "${YELLOW}🔐 Checking AWS permissions...${NC}"
    
    # Test basic permissions
    local permissions_ok=true
    
    # Test CloudFormation permissions
    if ! aws cloudformation list-stacks --region us-east-1 &> /dev/null; then
        echo -e "${RED}❌ No CloudFormation permissions${NC}"
        permissions_ok=false
    else
        echo -e "${GREEN}✅ CloudFormation permissions${NC}"
    fi
    
    # Test ECR permissions
    if ! aws ecr describe-repositories --region us-east-1 &> /dev/null; then
        echo -e "${RED}❌ No ECR permissions${NC}"
        permissions_ok=false
    else
        echo -e "${GREEN}✅ ECR permissions${NC}"
    fi
    
    # Test ECS permissions
    if ! aws ecs list-clusters --region us-east-1 &> /dev/null; then
        echo -e "${RED}❌ No ECS permissions${NC}"
        permissions_ok=false
    else
        echo -e "${GREEN}✅ ECS permissions${NC}"
    fi
    
    if [ "$permissions_ok" = false ]; then
        echo
        echo -e "${RED}❌ Missing required AWS permissions${NC}"
        echo "Your IAM user needs the policy defined in docs/AWS_DEPLOYMENT_STRATEGY.md"
        return 1
    else
        echo -e "${GREEN}✅ Required AWS permissions are available${NC}"
        return 0
    fi
}

# Check Docker installation
check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker is not installed${NC}"
        echo "Install Docker: https://docs.docker.com/get-docker/"
        return 1
    fi
    
    if ! docker info &> /dev/null; then
        echo -e "${RED}❌ Docker is not running${NC}"
        echo "Please start Docker Desktop or Docker daemon"
        return 1
    fi
    
    echo -e "${GREEN}✅ Docker is installed and running${NC}"
    return 0
}

# Check CDK installation and bootstrap
check_cdk() {
    local cdk_ok=true
    
    # Check if CDK is available globally or locally
    if command -v cdk &> /dev/null; then
        echo -e "${GREEN}✅ CDK is installed globally${NC}"
        cdk --version
    elif [ -f "aws-infrastructure/node_modules/.bin/cdk" ]; then
        echo -e "${GREEN}✅ CDK is available locally${NC}"
        cd aws-infrastructure && npx cdk --version && cd ..
    else
        echo -e "${YELLOW}⚠️  CDK not found globally, will use local installation${NC}"
    fi
    
    # Check CDK bootstrap
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    REGION=$(aws configure get region || echo "us-east-1")
    
    if aws cloudformation describe-stacks --stack-name CDKToolkit --region $REGION &> /dev/null; then
        echo -e "${GREEN}✅ CDK is bootstrapped for $ACCOUNT_ID in $REGION${NC}"
    else
        echo -e "${YELLOW}⚠️  CDK is not bootstrapped${NC}"
        echo "Run: cdk bootstrap aws://$ACCOUNT_ID/$REGION"
        cdk_ok=false
    fi
    
    if [ "$cdk_ok" = false ]; then
        return 1
    else
        return 0
    fi
}

# Main validation function
main() {
    local overall_status=0
    
    echo "This script validates your local AWS setup for Postolio deployment."
    echo
    
    # Run all checks
    check_aws_cli || overall_status=1
    echo
    
    check_aws_credentials || overall_status=1
    echo
    
    check_permissions || overall_status=1
    echo
    
    check_docker || overall_status=1
    echo
    
    check_cdk || overall_status=1
    echo
    
    # Summary
    if [ $overall_status -eq 0 ]; then
        echo -e "${GREEN}🎉 All validations passed!${NC}"
        echo
        echo "✅ Your AWS setup is ready for Postolio deployment"
        echo
        echo "Next steps:"
        echo "1. Configure the GitHub repository secrets shown above"
        echo "2. Push your code to trigger the deployment workflow"
        echo "3. Monitor the deployment in the GitHub Actions tab"
        echo
        echo "For manual deployment, run:"
        echo "./scripts/deploy-aws.sh dev"
    else
        echo -e "${RED}❌ Some validations failed${NC}"
        echo
        echo "Please fix the issues above before attempting deployment."
        echo "See docs/AWS_DEPLOYMENT_STRATEGY.md for detailed setup instructions."
        exit 1
    fi
}

main