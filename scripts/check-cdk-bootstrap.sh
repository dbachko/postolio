#!/bin/bash

# Check if CDK bootstrap is needed for a given AWS account and region
# Returns 0 if bootstrap is needed, 1 if already bootstrapped
# Usage: ./check-cdk-bootstrap.sh [account-id] [region]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get AWS account and region
AWS_ACCOUNT="${1:-$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo '')}"
AWS_REGION="${2:-${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}}"

# Validate we have account ID
if [ -z "$AWS_ACCOUNT" ]; then
    echo -e "${RED}❌ Could not determine AWS account ID${NC}" >&2
    echo "Please ensure AWS credentials are configured" >&2
    exit 2
fi

# Function to check if CDKToolkit stack exists
check_cdk_toolkit_stack() {
    aws cloudformation describe-stacks \
        --stack-name CDKToolkit \
        --region "$AWS_REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "NOT_FOUND"
}

# Function to check CDK bootstrap version
check_bootstrap_version() {
    aws ssm get-parameter \
        --name "/cdk-bootstrap/hnb659fds/version" \
        --region "$AWS_REGION" \
        --query 'Parameter.Value' \
        --output text 2>/dev/null || echo "0"
}

echo "🔍 Checking CDK bootstrap status for aws://$AWS_ACCOUNT/$AWS_REGION..."

# Check if CDKToolkit stack exists
STACK_STATUS=$(check_cdk_toolkit_stack)

if [ "$STACK_STATUS" = "NOT_FOUND" ]; then
    echo -e "${YELLOW}⚠️  CDK bootstrap not found${NC}"
    echo "Bootstrap is required for aws://$AWS_ACCOUNT/$AWS_REGION"
    exit 0  # Bootstrap needed
fi

# Check stack status
case "$STACK_STATUS" in
    CREATE_COMPLETE|UPDATE_COMPLETE|UPDATE_ROLLBACK_COMPLETE)
        echo -e "${GREEN}✅ CDKToolkit stack exists (Status: $STACK_STATUS)${NC}"
        ;;
    CREATE_IN_PROGRESS|UPDATE_IN_PROGRESS)
        echo -e "${YELLOW}⏳ CDKToolkit stack operation in progress (Status: $STACK_STATUS)${NC}"
        echo "Waiting for stack operation to complete..."
        exit 1  # Already bootstrapped, but busy
        ;;
    DELETE_IN_PROGRESS|DELETE_COMPLETE)
        echo -e "${YELLOW}⚠️  CDKToolkit stack is being deleted (Status: $STACK_STATUS)${NC}"
        echo "Bootstrap will be required after deletion completes"
        exit 0  # Bootstrap needed
        ;;
    CREATE_FAILED|ROLLBACK_COMPLETE|ROLLBACK_FAILED|UPDATE_ROLLBACK_FAILED)
        echo -e "${RED}❌ CDKToolkit stack is in failed state (Status: $STACK_STATUS)${NC}"
        echo "Manual intervention may be required"
        exit 2  # Error state
        ;;
    *)
        echo -e "${YELLOW}⚠️  CDKToolkit stack in unexpected state: $STACK_STATUS${NC}"
        exit 2  # Error state
        ;;
esac

# Check bootstrap version
BOOTSTRAP_VERSION=$(check_bootstrap_version)
REQUIRED_VERSION=18  # CDK v2 requires at least version 6, but 18+ is recommended

if [ "$BOOTSTRAP_VERSION" -lt "$REQUIRED_VERSION" ]; then
    echo -e "${YELLOW}⚠️  CDK bootstrap version $BOOTSTRAP_VERSION is outdated (required: $REQUIRED_VERSION+)${NC}"
    echo "Re-bootstrap recommended for aws://$AWS_ACCOUNT/$AWS_REGION"
    exit 0  # Bootstrap needed
fi

echo -e "${GREEN}✅ CDK bootstrap is up-to-date (version: $BOOTSTRAP_VERSION)${NC}"
echo "No bootstrap required for aws://$AWS_ACCOUNT/$AWS_REGION"
exit 1  # Bootstrap not needed