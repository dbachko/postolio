#!/bin/bash

set -e

echo "🔧 Fixing API Gateway CloudWatch Logging Configuration..."

# Create IAM role for API Gateway CloudWatch logging
echo "📝 Creating IAM role for API Gateway CloudWatch logging..."

# Create trust policy document
cat > /tmp/apigateway-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "apigateway.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create the role
ROLE_ARN=$(aws iam create-role \
  --role-name ApiGatewayCloudWatchLogsRole \
  --assume-role-policy-document file:///tmp/apigateway-trust-policy.json \
  --query 'Role.Arn' \
  --output text 2>/dev/null || \
  aws iam get-role --role-name ApiGatewayCloudWatchLogsRole --query 'Role.Arn' --output text)

echo "✅ IAM Role ARN: $ROLE_ARN"

# Attach CloudWatch Logs policy to the role
echo "📎 Attaching CloudWatch Logs policy..."
aws iam attach-role-policy \
  --role-name ApiGatewayCloudWatchLogsRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs 2>/dev/null || true

# Wait for IAM role propagation
echo "⏳ Waiting for IAM role propagation..."
sleep 5

# Configure API Gateway account settings
echo "⚙️ Configuring API Gateway account settings..."
aws apigateway update-account \
  --patch-operations op=replace,path=/cloudwatchRoleArn,value=$ROLE_ARN

echo "✅ API Gateway CloudWatch logging configured successfully!"

# Clean up temp file
rm -f /tmp/apigateway-trust-policy.json

echo ""
echo "🚀 You can now redeploy your stack:"
echo "   npx cdk deploy ContentScheduler-dev"