#!/bin/bash

# Script to fix stuck CDK bootstrap stack and update IAM permissions
# This helps resolve the UPDATE_ROLLBACK_FAILED state

set -e

echo "🔧 CDK Bootstrap Stack Fix Script"
echo "================================="
echo

# Check if AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "❌ AWS CLI is not configured. Please configure AWS credentials first."
    exit 1
fi

# Get current AWS identity
IDENTITY=$(aws sts get-caller-identity)
echo "📋 Current AWS Identity:"
echo "$IDENTITY"
echo

# Check if running as the GitHub Actions user
if echo "$IDENTITY" | grep -q "postolio-github-actions"; then
    echo "⚠️  You're running as the GitHub Actions user."
    echo "   This user needs the iam:UpdateAssumeRolePolicy permission."
    echo
    echo "📝 Please update the IAM policy with this permission:"
    echo "   1. Go to AWS Console > IAM > Users > postolio-github-actions"
    echo "   2. Click on the attached policy"
    echo "   3. Edit the policy and add 'iam:UpdateAssumeRolePolicy' to the InfrastructureManagement statement"
    echo
    echo "   The updated actions list should include:"
    echo "   - iam:UpdateRole"
    echo "   - iam:UpdateAssumeRolePolicy  <-- Add this line"
    echo "   - sts:AssumeRole"
    echo
    read -p "Have you updated the IAM policy? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Please update the IAM policy and try again."
        exit 1
    fi
fi

# Check CDK bootstrap stack status
echo "🔍 Checking CDK bootstrap stack status..."
STACK_STATUS=$(aws cloudformation describe-stacks --stack-name CDKToolkit --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$STACK_STATUS" = "NOT_FOUND" ]; then
    echo "✅ CDK bootstrap stack not found. Will create fresh."
elif [ "$STACK_STATUS" = "UPDATE_ROLLBACK_FAILED" ]; then
    echo "⚠️  CDK bootstrap stack is in UPDATE_ROLLBACK_FAILED state."
    echo "   Attempting to continue rollback..."
    
    # Try to continue the rollback
    aws cloudformation continue-update-rollback --stack-name CDKToolkit \
        --resources-to-skip FilePublishingRole ImagePublishingRole LookupRole 2>/dev/null || true
    
    # Wait for rollback to complete
    echo "⏳ Waiting for rollback to complete (this may take a few minutes)..."
    aws cloudformation wait stack-update-complete --stack-name CDKToolkit 2>/dev/null || true
    
    # Check status again
    STACK_STATUS=$(aws cloudformation describe-stacks --stack-name CDKToolkit --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
    echo "   Stack status after rollback: $STACK_STATUS"
    
    if [ "$STACK_STATUS" = "UPDATE_ROLLBACK_COMPLETE" ]; then
        echo "✅ Rollback completed successfully."
    elif [ "$STACK_STATUS" = "UPDATE_ROLLBACK_FAILED" ]; then
        echo "❌ Rollback still failed. You may need to delete and recreate the stack."
        echo
        echo "To delete the stuck stack manually:"
        echo "  1. Go to AWS Console > CloudFormation"
        echo "  2. Select the CDKToolkit stack"
        echo "  3. Actions > Delete stack"
        echo "  4. Check 'Retain resources' for the failed resources"
        echo "  5. Delete the stack"
        echo
        echo "Then re-run this script to bootstrap fresh."
        exit 1
    fi
elif [ "$STACK_STATUS" = "CREATE_COMPLETE" ] || [ "$STACK_STATUS" = "UPDATE_COMPLETE" ]; then
    echo "✅ CDK bootstrap stack is healthy (status: $STACK_STATUS)"
else
    echo "⚠️  CDK bootstrap stack status: $STACK_STATUS"
fi

# Now try to bootstrap CDK
echo
echo "🚀 Running CDK bootstrap..."
echo

# Get AWS account ID and region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-us-east-1}

echo "   Account: $AWS_ACCOUNT_ID"
echo "   Region: $AWS_REGION"
echo

# Run CDK bootstrap
npx cdk bootstrap "aws://${AWS_ACCOUNT_ID}/${AWS_REGION}" \
    --cloudformation-execution-policies "arn:aws:iam::aws:policy/AdministratorAccess" \
    2>&1 | tee bootstrap.log

# Check if bootstrap succeeded
if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo
    echo "✅ CDK bootstrap completed successfully!"
    echo
    echo "Next steps:"
    echo "  1. Commit the updated IAM policy documentation"
    echo "  2. Push to trigger the deployment pipeline"
    echo "  3. The deployment should now work with the updated permissions"
else
    echo
    echo "❌ CDK bootstrap failed. Check bootstrap.log for details."
    echo
    echo "Common fixes:"
    echo "  1. Ensure the IAM user has iam:UpdateAssumeRolePolicy permission"
    echo "  2. Delete the CDKToolkit stack manually if it's stuck"
    echo "  3. Check for any resource naming conflicts"
    exit 1
fi