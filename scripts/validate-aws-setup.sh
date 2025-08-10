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
echo "Validates AWS configuration for secure infrastructure deployment"
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

# Check CDK bootstrap status and permissions
check_bootstrap_permissions() {
    echo -e "${YELLOW}🔧 Checking CDK bootstrap status...${NC}"
    
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    REGION=$(aws configure get region || echo "us-east-1")
    
    # First check if already bootstrapped
    if aws cloudformation describe-stacks --stack-name CDKToolkit --region $REGION &> /dev/null; then
        echo -e "${GREEN}✅ CDK is already bootstrapped for $ACCOUNT_ID in $REGION${NC}"
        return 0
    fi
    
    echo -e "${YELLOW}⚠️  CDK is not bootstrapped yet${NC}"
    echo "Testing bootstrap permissions..."
    
    local can_bootstrap=true
    local permission_issues=()
    
    # Test CloudFormation permissions (most critical)
    echo -n "Testing CloudFormation permissions... "
    if aws cloudformation describe-stacks --region $REGION &> /dev/null || aws cloudformation list-stacks --max-items 1 --region $REGION &> /dev/null; then
        echo "✓"
    else
        echo "✗"
        permission_issues+=("CloudFormation: Cannot list/describe stacks - likely missing cloudformation:* permissions")
        can_bootstrap=false
    fi
    
    # Test S3 permissions
    echo -n "Testing S3 permissions... "
    if aws s3api list-buckets &> /dev/null; then
        echo "✓"
    else
        echo "✗"
        permission_issues+=("S3: Cannot list buckets - likely missing s3:* permissions")
        can_bootstrap=false
    fi
    
    # Test IAM permissions
    echo -n "Testing IAM permissions... "
    if aws iam list-roles --max-items 1 &> /dev/null; then
        echo "✓"
    else
        echo "✗" 
        permission_issues+=("IAM: Cannot list roles - likely missing iam:* permissions")
        can_bootstrap=false
    fi
    
    # Test SSM permissions (CDK stores bootstrap version here)
    echo -n "Testing SSM permissions... "
    if aws ssm describe-parameters --max-items 1 --region $REGION &> /dev/null; then
        echo "✓"
    else
        echo "✗"
        permission_issues+=("SSM: Cannot describe parameters - likely missing ssm:* permissions") 
        can_bootstrap=false
    fi
    
    echo
    
    if [ "$can_bootstrap" = true ]; then
        echo -e "${GREEN}✅ You appear to have sufficient permissions for CDK bootstrap${NC}"
        echo -e "${YELLOW}💡 To bootstrap now, run:${NC}"
        echo "   cdk bootstrap aws://$ACCOUNT_ID/$REGION"
        echo
        echo "Or let the deployment script handle it automatically."
        return 0
    else
        echo -e "${RED}❌ Missing permissions for CDK bootstrap${NC}"
        echo
        echo "Issues found:"
        for issue in "${permission_issues[@]}"; do
            echo "  • $issue"
        done
        echo
        echo -e "${YELLOW}💡 Solutions:${NC}"
        echo "1. 🏢 Ask your AWS administrator to:"
        echo "   • Grant you the IAM policy from docs/AWS_DEPLOYMENT_STRATEGY.md"
        echo "   • Or run: cdk bootstrap aws://$ACCOUNT_ID/$REGION"
        echo
        echo "2. 🌩️  Try AWS CloudShell (may have broader permissions):"
        echo "   • Open CloudShell in AWS Console"
        echo "   • Run: npm install -g aws-cdk && cdk bootstrap"
        echo
        echo "3. 📧 Use GitHub Actions (if properly configured):"
        echo "   • The CI/CD pipeline will handle bootstrap automatically"
        echo
        return 1
    fi
}

# Check required permissions for deployment
check_permissions() {
    echo -e "${YELLOW}🔐 Checking AWS deployment permissions...${NC}"
    
    REGION=$(aws configure get region || echo "us-east-1")
    local permissions_ok=true
    local permission_issues=()
    
    # Test CloudFormation permissions
    echo -n "Testing CloudFormation permissions... "
    if aws cloudformation list-stacks --region $REGION &> /dev/null; then
        echo "✓"
    else
        echo "✗"
        permission_issues+=("CloudFormation: Missing cloudformation:* permissions")
        permissions_ok=false
    fi
    
    # Test ECR permissions  
    echo -n "Testing ECR permissions... "
    if aws ecr describe-repositories --region $REGION &> /dev/null; then
        echo "✓"
    else
        echo "✗"
        permission_issues+=("ECR: Missing ecr:* permissions")
        permissions_ok=false
    fi
    
    # Test ECS permissions
    echo -n "Testing ECS permissions... "
    if aws ecs list-clusters --region $REGION &> /dev/null; then
        echo "✓"
    else
        echo "✗"
        permission_issues+=("ECS: Missing ecs:* permissions")
        permissions_ok=false
    fi
    
    # Test VPC/EC2 permissions (for secure infrastructure)
    echo -n "Testing VPC/EC2 permissions... "
    if aws ec2 describe-vpcs --max-items 1 --region $REGION &> /dev/null; then
        echo "✓"
    else
        echo "✗"
        permission_issues+=("EC2/VPC: Missing ec2:* permissions for secure networking")
        permissions_ok=false
    fi
    
    # Test RDS permissions
    echo -n "Testing RDS permissions... "
    if aws rds describe-db-instances --max-items 1 --region $REGION &> /dev/null; then
        echo "✓"
    else
        echo "✗"
        permission_issues+=("RDS: Missing rds:* permissions")
        permissions_ok=false
    fi
    
    echo
    
    if [ "$permissions_ok" = false ]; then
        echo -e "${RED}❌ Missing required AWS deployment permissions${NC}"
        echo
        echo "Permission issues found:"
        for issue in "${permission_issues[@]}"; do
            echo "  • $issue"
        done
        echo
        echo -e "${YELLOW}💡 Solution:${NC}"
        echo "Your IAM user needs the complete policy from docs/AWS_DEPLOYMENT_STRATEGY.md"
        echo "This includes permissions for: CloudFormation, ECS, ECR, RDS, VPC, S3, CloudFront, etc."
        return 1
    else
        echo -e "${GREEN}✅ AWS deployment permissions look good${NC}"
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

# Check CDK installation
check_cdk() {
    echo -e "${YELLOW}📦 Checking CDK installation...${NC}"
    
    # Check if CDK is available globally or locally
    if command -v cdk &> /dev/null; then
        echo -e "${GREEN}✅ CDK is installed globally${NC}"
        cdk --version
        return 0
    elif [ -f "aws-infrastructure/node_modules/.bin/cdk" ]; then
        echo -e "${GREEN}✅ CDK is available locally${NC}"
        cd aws-infrastructure && npx cdk --version && cd ..
        return 0
    else
        echo -e "${YELLOW}⚠️  CDK not found globally, will install locally during deployment${NC}"
        echo "The deployment script will handle CDK installation automatically."
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
    
    check_bootstrap_permissions || overall_status=1
    echo
    
    check_docker || overall_status=1
    echo
    
    check_cdk || overall_status=1
    echo
    
    # Summary
    if [ $overall_status -eq 0 ]; then
        echo -e "${GREEN}🎉 All validations passed!${NC}"
        echo
        echo "✅ Your AWS setup is ready for secure Postolio deployment"
        echo "🛡️  Features: VPC Flow Logs, encrypted storage, CDK Nag validation"
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