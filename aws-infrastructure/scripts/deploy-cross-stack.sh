#!/bin/bash

# Cross-Stack Deployment Script
# This script demonstrates multiple approaches to deploy stacks with cross-stack dependencies

set -e

ENVIRONMENT=${1:-dev}
APPROACH=${2:-unified}

echo "🚀 Deploying Postolio with ContentScheduler integration"
echo "Environment: $ENVIRONMENT"
echo "Approach: $APPROACH"
echo ""

case $APPROACH in
  "unified")
    echo "📦 Approach 1: Unified Deployment (Recommended)"
    echo "Deploying both stacks together with automatic dependency resolution..."
    
    npx cdk deploy \
      --app "npx ts-node bin/unified-app.ts" \
      --context environment=$ENVIRONMENT \
      --all \
      --require-approval never \
      --outputs-file cdk-outputs-unified.json
    
    echo "✅ Unified deployment completed!"
    echo "📄 Outputs saved to: cdk-outputs-unified.json"
    ;;
    
  "sequential")
    echo "📦 Approach 2: Sequential Deployment"
    echo "1️⃣  Deploying ContentScheduler stack first..."
    
    npx cdk deploy ContentScheduler-$ENVIRONMENT \
      --app "npx ts-node bin/scheduler-app.ts" \
      --context environment=$ENVIRONMENT \
      --require-approval never \
      --outputs-file cdk-outputs-scheduler.json
    
    echo "2️⃣  Deploying Postolio stack with imported values..."
    
    # Extract API URL from ContentScheduler outputs
    SCHEDULER_API_URL=$(cat cdk-outputs-scheduler.json | jq -r '.["ContentScheduler-'$ENVIRONMENT'"].ApiEndpoint // empty')
    
    if [ -z "$SCHEDULER_API_URL" ]; then
      echo "❌ Failed to extract ContentScheduler API URL from outputs"
      exit 1
    fi
    
    echo "🔗 ContentScheduler API URL: $SCHEDULER_API_URL"
    
    # Deploy Postolio with environment variable
    SCHEDULER_API_URL=$SCHEDULER_API_URL npx cdk deploy Postolio-$ENVIRONMENT \
      --app "npx ts-node bin/app.ts" \
      --context environment=$ENVIRONMENT \
      --require-approval never \
      --outputs-file cdk-outputs-postolio.json
    
    echo "✅ Sequential deployment completed!"
    ;;
    
  "import")
    echo "📦 Approach 3: Import from Existing Stack"
    echo "Importing ContentScheduler API URL using CloudFormation exports..."
    
    # Check if ContentScheduler stack exists
    if ! aws cloudformation describe-stacks --stack-name ContentScheduler-$ENVIRONMENT > /dev/null 2>&1; then
      echo "❌ ContentScheduler-$ENVIRONMENT stack not found!"
      echo "Deploy ContentScheduler first:"
      echo "  npx cdk deploy ContentScheduler-$ENVIRONMENT --app 'npx ts-node bin/scheduler-app.ts' --context environment=$ENVIRONMENT"
      exit 1
    fi
    
    # Deploy Postolio with cross-stack imports
    npx cdk deploy Postolio-$ENVIRONMENT \
      --app "npx ts-node bin/app.ts" \
      --context environment=$ENVIRONMENT \
      --require-approval never \
      --outputs-file cdk-outputs-postolio.json
    
    echo "✅ Import-based deployment completed!"
    ;;
    
  *)
    echo "❌ Invalid approach: $APPROACH"
    echo "Valid approaches: unified, sequential, import"
    exit 1
    ;;
esac

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Next Steps:"
echo "1. Update application secrets in AWS Secrets Manager with your API keys"
echo "2. Test the ContentScheduler integration using the provided API endpoints"
echo "3. Monitor CloudWatch logs for any integration issues"
echo ""
echo "🔧 Useful Commands:"
echo "  # View stack outputs"
echo "  aws cloudformation describe-stacks --stack-name ContentScheduler-$ENVIRONMENT --query 'Stacks[0].Outputs'"
echo "  aws cloudformation describe-stacks --stack-name Postolio-$ENVIRONMENT --query 'Stacks[0].Outputs'"
echo ""
echo "  # Test ContentScheduler API"
echo "  curl -X GET \$(aws cloudformation describe-stacks --stack-name ContentScheduler-$ENVIRONMENT --query 'Stacks[0].Outputs[?OutputKey==\`ApiEndpoint\`].OutputValue' --output text)/health"