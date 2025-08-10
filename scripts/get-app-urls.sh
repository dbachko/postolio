#!/bin/bash
set -e

STACK_NAME="Postolio-dev"
echo "🔍 Getting URLs for $STACK_NAME..."
echo

# Check if stack exists and is complete
STACK_STATUS=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$STACK_STATUS" = "NOT_FOUND" ]; then
    echo "❌ Stack $STACK_NAME not found!"
    exit 1
fi

if [ "$STACK_STATUS" = "CREATE_IN_PROGRESS" ]; then
    echo "⏳ Stack is still being created..."
    echo "   Current status: $STACK_STATUS"
    echo "   Run this script again once deployment completes."
    exit 0
fi

if [ "$STACK_STATUS" != "CREATE_COMPLETE" ] && [ "$STACK_STATUS" != "UPDATE_COMPLETE" ]; then
    echo "❌ Stack status: $STACK_STATUS"
    echo "   Deployment may have failed. Check AWS Console for details."
    exit 1
fi

echo "✅ Stack status: $STACK_STATUS"
echo

# Get outputs
echo "📱 APPLICATION URLS:"
echo "==================="

FRONTEND_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`ApplicationURL`].OutputValue' \
    --output text 2>/dev/null)

BACKEND_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
    --output text 2>/dev/null)

CLOUDFRONT_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`FrontendDistributionDomainName`].OutputValue' \
    --output text 2>/dev/null)

if [ -n "$FRONTEND_URL" ]; then
    echo "🌐 Frontend App:     $FRONTEND_URL"
else
    echo "🌐 Frontend App:     https://$CLOUDFRONT_URL"
fi

if [ -n "$BACKEND_URL" ]; then
    echo "🚀 Backend API:      https://$BACKEND_URL"
    echo "💊 Health Check:     https://$BACKEND_URL/health"
fi

echo
echo "📊 USEFUL ENDPOINTS:"
echo "===================="
if [ -n "$BACKEND_URL" ]; then
    echo "Auth:               https://$BACKEND_URL/auth/login"
    echo "Brands:             https://$BACKEND_URL/brands/list"
    echo "API Documentation:  https://$BACKEND_URL/docs (if available)"
fi

echo
echo "🔧 AWS RESOURCES:"
echo "================="

# Get other useful outputs
BUCKET_NAME=$(aws cloudformation describe-stacks --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`FrontendBucketName`].OutputValue' \
    --output text 2>/dev/null)

DATABASE_ENDPOINT=$(aws cloudformation describe-stacks --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`DatabaseEndpoint`].OutputValue' \
    --output text 2>/dev/null)

REDIS_ENDPOINT=$(aws cloudformation describe-stacks --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`RedisEndpoint`].OutputValue' \
    --output text 2>/dev/null)

ECR_REPO=$(aws cloudformation describe-stacks --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`ECRRepository`].OutputValue' \
    --output text 2>/dev/null)

echo "S3 Bucket:          $BUCKET_NAME"
echo "Database:           $DATABASE_ENDPOINT:5433"
echo "Redis:              $REDIS_ENDPOINT:6380"
echo "ECR Repository:     $ECR_REPO"

echo
echo "🚀 Ready to go! Open the frontend URL in your browser."
echo "   Note: It may take a few minutes for all services to fully initialize."