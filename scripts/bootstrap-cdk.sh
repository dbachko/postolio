#!/bin/bash

# CDK Bootstrap Script for Postolio
# Provides multiple options for bootstrapping CDK based on available permissions

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION=${AWS_REGION:-us-east-1}

echo -e "${BLUE}🚀 CDK Bootstrap for Postolio${NC}"
echo "================================"
echo

# Get AWS account info
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    echo "Please run: aws configure"
    exit 1
fi

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
USER_ARN=$(aws sts get-caller-identity --query Arn --output text)

echo "AWS Account: $AWS_ACCOUNT"
echo "User/Role: $USER_ARN"
echo "Region: $AWS_REGION"
echo

# Check if already bootstrapped
if aws cloudformation describe-stacks --stack-name CDKToolkit --region $AWS_REGION &> /dev/null; then
    echo -e "${GREEN}✅ CDK is already bootstrapped for this account and region${NC}"
    
    # Show bootstrap info
    echo
    echo "Bootstrap stack details:"
    aws cloudformation describe-stacks --stack-name CDKToolkit --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`BucketName`].OutputValue' \
        --output text | sed 's/^/  S3 Bucket: /'
    
    echo
    echo "You can proceed with deployment:"
    echo "./scripts/deploy-aws.sh dev"
    exit 0
fi

echo -e "${YELLOW}CDK is not bootstrapped. Checking permissions...${NC}"

# Function to test bootstrap permissions
test_bootstrap_permissions() {
    local can_bootstrap=true
    local missing_perms=()
    
    # Test CloudFormation permissions
    if ! aws cloudformation list-stacks --region $AWS_REGION &> /dev/null; then
        missing_perms+=("CloudFormation")
        can_bootstrap=false
    fi
    
    # Test S3 permissions
    if ! aws s3api list-buckets &> /dev/null; then
        missing_perms+=("S3")
        can_bootstrap=false
    fi
    
    # Test IAM permissions
    if ! aws iam list-roles --max-items 1 &> /dev/null; then
        missing_perms+=("IAM")
        can_bootstrap=false
    fi
    
    if [ "$can_bootstrap" = true ]; then
        echo -e "${GREEN}✅ You have sufficient permissions for bootstrap${NC}"
        return 0
    else
        echo -e "${RED}❌ Missing permissions: ${missing_perms[*]}${NC}"
        return 1
    fi
}

# Function to perform bootstrap
do_bootstrap() {
    echo -e "${YELLOW}Bootstrapping CDK...${NC}"
    echo "This will create:"
    echo "  - S3 bucket for CDK assets"
    echo "  - IAM roles for CDK deployments"
    echo "  - ECR repository for container images"
    echo "  - SSM parameters for configuration"
    echo
    
    echo "Bootstrapping CDK for aws://$AWS_ACCOUNT/$AWS_REGION..."
    
    if npx cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION; then
        echo -e "${GREEN}✅ CDK bootstrap completed successfully!${NC}"
        echo
        echo "Next steps:"
        echo "1. Deploy Postolio: ./scripts/deploy-aws.sh dev"
        echo "2. Monitor deployment progress"
        return 0
    else
        echo -e "${RED}❌ CDK bootstrap failed${NC}"
        return 1
    fi
}

# Function to show manual bootstrap options
show_manual_options() {
    echo -e "${YELLOW}Manual Bootstrap Options:${NC}"
    echo
    echo "1. AWS Console Method:"
    echo "   - Go to CloudFormation console"
    echo "   - Create stack with existing template"
    echo "   - Use this URL as template source:"
    echo "     https://s3.amazonaws.com/cdk-assets-$AWS_REGION/toolkit-bootstrap-template.json"
    echo "   - Stack name: CDKToolkit"
    echo "   - Leave all parameters as default"
    echo
    echo "2. AWS CloudShell Method:"
    echo "   - Open AWS CloudShell from the AWS Console"
    echo "   - Run: npm install -g aws-cdk"
    echo "   - Run: cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION"
    echo
    echo "3. Administrator Method:"
    echo "   Ask your AWS administrator to run:"
    echo "   cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION"
    echo
    echo "4. IAM Permissions Method:"
    echo "   Ask your administrator to add these permissions to your IAM user:"
    cat << 'EOF'
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "cloudformation:CreateStack",
           "cloudformation:CreateChangeSet",
           "cloudformation:DescribeStacks",
           "cloudformation:UpdateStack",
           "s3:CreateBucket",
           "s3:PutBucketPolicy",
           "s3:PutBucketVersioning",
           "s3:PutEncryptionConfiguration",
           "iam:CreateRole",
           "iam:AttachRolePolicy",
           "iam:PassRole",
           "ssm:PutParameter"
         ],
         "Resource": "*"
       }
     ]
   }
EOF
}

# Main logic
if test_bootstrap_permissions; then
    echo
    echo -e "${YELLOW}Proceeding with automatic bootstrap...${NC}"
    
    read -p "Continue with CDK bootstrap? (y/N): " -r
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if do_bootstrap; then
            exit 0
        else
            echo
            show_manual_options
            exit 1
        fi
    else
        echo "Bootstrap cancelled by user."
        show_manual_options
        exit 1
    fi
else
    echo
    echo "You don't have sufficient permissions for automatic bootstrap."
    echo
    show_manual_options
    exit 1
fi