#!/bin/bash

# AWS SES Setup Script for Postolio
# This script helps verify domain and email addresses in AWS SES

set -e

REGION=${AWS_REGION:-us-east-1}
DOMAIN=${1:-postolio.example}
FROM_EMAIL="noreply@$DOMAIN"

echo "🔧 Setting up AWS SES for Postolio"
echo "Region: $REGION"
echo "Domain: $DOMAIN"
echo "From Email: $FROM_EMAIL"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Please run 'aws configure'"
    exit 1
fi

echo "📧 Step 1: Verifying email address..."
aws ses verify-email-identity --email-address "$FROM_EMAIL" --region "$REGION" 2>/dev/null || true
echo "✅ Verification email sent to $FROM_EMAIL"
echo "   Please check your inbox and click the verification link."
echo ""

echo "🌐 Step 2: Verifying domain..."
aws ses verify-domain-identity --domain "$DOMAIN" --region "$REGION" --output json > ses-domain-verification.json
VERIFICATION_TOKEN=$(cat ses-domain-verification.json | grep VerificationToken | cut -d'"' -f4)

echo "✅ Domain verification initiated"
echo ""
echo "📝 Add this TXT record to your DNS:"
echo "   Name: _amazonses.$DOMAIN"
echo "   Type: TXT"
echo "   Value: $VERIFICATION_TOKEN"
echo ""

echo "🔍 Step 3: Checking current verification status..."
aws ses get-identity-verification-attributes \
    --identities "$DOMAIN" "$FROM_EMAIL" \
    --region "$REGION" \
    --output table

echo ""
echo "📊 Step 4: Checking SES sending quota..."
aws ses describe-configuration-set --region "$REGION" 2>/dev/null || \
    aws ses get-send-quota --region "$REGION" --output table

echo ""
echo "🏷️ Step 5: Checking if in sandbox mode..."
SANDBOX_STATUS=$(aws ses describe-configuration-set --region "$REGION" 2>&1 || echo "sandbox")
if [[ "$SANDBOX_STATUS" == *"sandbox"* ]]; then
    echo "⚠️  Your account is in sandbox mode. You can only send to verified emails."
    echo "   To move out of sandbox, request production access in AWS Console:"
    echo "   https://console.aws.amazon.com/ses/home?region=$REGION#/account"
else
    echo "✅ Your account is in production mode"
fi

echo ""
echo "✨ SES Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Click the verification link in the email sent to $FROM_EMAIL"
echo "2. Add the TXT record to your DNS provider"
echo "3. Wait for DNS propagation (usually 10-30 minutes)"
echo "4. Deploy your application with SES enabled"
echo ""
echo "Environment variables for your app:"
echo "  USE_AWS_SES=true"
echo "  AWS_REGION=$REGION"
echo "  SES_FROM_EMAIL=$FROM_EMAIL"

# Clean up
rm -f ses-domain-verification.json