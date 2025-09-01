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

# Publisher now uses AWS IAM SigV4 authentication - no API key needed
# Services authenticate using IAM roles instead of shared API keys

# Step 1: Deploy ContentScheduler stack first
echo ""
echo "Step 1: Deploying ContentScheduler stack..."
echo "-----------------------------------------"
npx cdk deploy ContentScheduler-${ENVIRONMENT} \
  --require-approval never \
  --context environment=${ENVIRONMENT} \
  || { echo "ContentScheduler deployment failed"; exit 1; }

echo ""
echo "✅ ContentScheduler stack deployed successfully"

# Step 2: Deploy Postolio stack
echo ""
echo "Step 2: Deploying Postolio stack..."
echo "-----------------------------------"
npx cdk deploy Postolio-${ENVIRONMENT} \
  --require-approval never \
  --context imageTag=${IMAGE_TAG} \
  --context environment=${ENVIRONMENT} \
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