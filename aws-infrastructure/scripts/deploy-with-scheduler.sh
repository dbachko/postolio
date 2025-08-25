#!/bin/bash

# Script to deploy ContentScheduler and Postolio stacks with proper dependencies
# This ensures scheduler service is available before main app deployment

set -e

ENVIRONMENT=${1:-dev}
IMAGE_TAG=${2:-latest}

echo "========================================="
echo "Deploying Postolio with Content Scheduler"
echo "Environment: $ENVIRONMENT"
echo "Image Tag: $IMAGE_TAG"
echo "========================================="

# Generate a consistent publisher API key for both stacks
if [ -z "$PUBLISHER_API_KEY" ]; then
  # Get existing key from secrets if available
  SECRET_ARN=$(aws secretsmanager list-secrets --query "SecretList[?contains(Name, 'AppSecrets')].ARN" --output text 2>/dev/null)
  if [ -n "$SECRET_ARN" ]; then
    PUBLISHER_API_KEY=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query SecretString --output text 2>/dev/null | jq -r '.publisherApiKey' 2>/dev/null)
  fi
  
  # Generate new key if not found
  if [ -z "$PUBLISHER_API_KEY" ] || [ "$PUBLISHER_API_KEY" == "null" ]; then
    PUBLISHER_API_KEY=$(openssl rand -base64 32)
    echo "Generated new PUBLISHER_API_KEY"
  else
    echo "Using existing PUBLISHER_API_KEY from secrets"
  fi
fi

# Step 1: Deploy ContentScheduler stack first
echo ""
echo "Step 1: Deploying ContentScheduler stack..."
echo "-----------------------------------------"
npx cdk deploy ContentScheduler-${ENVIRONMENT} \
  --require-approval never \
  --context environment=${ENVIRONMENT} \
  --context publisherApiKey="${PUBLISHER_API_KEY}" \
  || { echo "ContentScheduler deployment failed"; exit 1; }

echo ""
echo "✅ ContentScheduler stack deployed successfully"

# Step 2: Deploy Postolio stack with same publisher API key
echo ""
echo "Step 2: Deploying Postolio stack..."
echo "-----------------------------------"
npx cdk deploy Postolio-${ENVIRONMENT} \
  --require-approval never \
  --context imageTag=${IMAGE_TAG} \
  --context environment=${ENVIRONMENT} \
  --context publisherApiKey="${PUBLISHER_API_KEY}" \
  || { echo "Postolio deployment failed"; exit 1; }

echo ""
echo "✅ ContentScheduler stack deployed successfully"

# Step 3: Verify the deployment
echo ""
echo "Step 3: Verifying deployment..."
echo "-------------------------------"

# Get the scheduler API URL
SCHEDULER_API_URL=$(aws cloudformation describe-stacks \
  --stack-name ContentScheduler-${ENVIRONMENT} \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text)

# Get the application URL
APP_URL=$(aws cloudformation describe-stacks \
  --stack-name Postolio-${ENVIRONMENT} \
  --query "Stacks[0].Outputs[?OutputKey=='ApplicationURL'].OutputValue" \
  --output text)

echo "Scheduler API: $SCHEDULER_API_URL"
echo "Application URL: $APP_URL"

# Step 4: Force ECS service update to pick up new environment variables
echo ""
echo "Step 4: Updating ECS service..."
echo "-------------------------------"

# Get cluster and service names
CLUSTER_NAME=$(aws cloudformation describe-stacks \
  --stack-name Postolio-${ENVIRONMENT} \
  --query "Stacks[0].Outputs[?OutputKey=='EcsClusterName'].OutputValue" \
  --output text)

SERVICE_NAME=$(aws cloudformation describe-stacks \
  --stack-name Postolio-${ENVIRONMENT} \
  --query "Stacks[0].Outputs[?OutputKey=='EcsServiceName'].OutputValue" \
  --output text)

# Force new deployment
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SERVICE_NAME \
  --force-new-deployment \
  --no-cli-pager

echo "✅ ECS service update initiated"

echo ""
echo "========================================="
echo "Deployment Complete!"
echo "========================================="
echo "Scheduler API: $SCHEDULER_API_URL"
echo "Application: $APP_URL"
echo ""
echo "The ECS service is being updated with the new configuration."
echo "This may take a few minutes to complete."
echo ""
echo "To check the status:"
echo "aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --query 'services[0].deployments'"