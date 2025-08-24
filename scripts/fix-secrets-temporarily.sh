#!/bin/bash

# Temporary fix: Add OAuth client IDs back to AWS Secrets Manager
# These are public values but the current ECS task definition expects them in secrets
# After deploying the new CDK stack, these won't be needed in secrets anymore

set -e

echo "🔧 Temporarily adding OAuth client IDs to AWS Secrets Manager..."
echo "   (These will be removed after deploying the new CDK stack)"
echo ""

# Get the current environment (default to dev)
ENVIRONMENT="${1:-dev}"
SECRET_NAME="Postolio-${ENVIRONMENT}/AppSecrets"

echo "📍 Environment: $ENVIRONMENT"
echo "🔑 Secret Name: $SECRET_NAME"
echo ""

# Get the current secret value
echo "Fetching current secret..."
CURRENT_SECRET=$(aws secretsmanager get-secret-value --secret-id "$SECRET_NAME" --query SecretString --output text 2>/dev/null || echo "{}")

# Add the OAuth client IDs (these are public values, not actual secrets)
# Using placeholder values since they're now supposed to come from environment variables
UPDATED_SECRET=$(echo "$CURRENT_SECRET" | jq '. + {
  "googleClientId": "PLACEHOLDER_GOOGLE_CLIENT_ID",
  "facebookAppId": "PLACEHOLDER_FACEBOOK_APP_ID"
}')

# Update the secret
echo "Updating secret with temporary OAuth client IDs..."
aws secretsmanager update-secret \
  --secret-id "$SECRET_NAME" \
  --secret-string "$UPDATED_SECRET" \
  >/dev/null

echo "✅ Secret updated successfully!"
echo ""
echo "⚠️  IMPORTANT: These are temporary placeholder values!"
echo "   The real OAuth client IDs should come from GitHub Environment Variables."
echo "   Deploy the new CDK stack to stop using these from secrets."
echo ""
echo "Next steps:"
echo "1. The current ECS tasks should restart and work with these placeholders"
echo "2. Deploy the new CDK stack: npm run deploy:aws:dev"
echo "3. The new deployment will use environment variables instead of secrets"