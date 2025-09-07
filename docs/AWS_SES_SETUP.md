# AWS SES Email Setup Guide

This guide walks you through setting up AWS Simple Email Service (SES) for Postolio's email functionality.

## Why AWS SES?

- **Reliability**: 99.9% uptime SLA with AWS infrastructure
- **Deliverability**: Better inbox placement than SMTP
- **Cost-effective**: $0.10 per 1,000 emails
- **Scalability**: Handles millions of emails
- **Analytics**: Built-in bounce and complaint tracking
- **Integration**: Native AWS IAM authentication in production

## Architecture

```
Development:
  EmailService → SMTP (Gmail/SendGrid) → User Inbox

Production:
  EmailService → AWS SES API → User Inbox
```

## Prerequisites

1. AWS Account with appropriate permissions
2. AWS CLI installed and configured
3. Domain name for sending emails (e.g., postolio.example)

## Quick Setup

Run our automated setup script:

```bash
./scripts/setup-aws-ses.sh postolio.example
```

This script will:
1. Verify your email address
2. Initiate domain verification
3. Check verification status
4. Display sending quota
5. Check sandbox status

## Manual Setup Steps

### 1. Verify Email Address

```bash
aws ses verify-email-identity \
  --email-address noreply@postolio.example \
  --region us-east-1
```

Check your email and click the verification link.

### 2. Verify Domain

```bash
aws ses verify-domain-identity \
  --domain postolio.example \
  --region us-east-1
```

Add the returned TXT record to your DNS:
- Name: `_postolio.example`
- Type: `TXT`
- Value: `[verification-token]`

### 3. Configure DKIM (Optional but Recommended)

```bash
aws ses put-identity-dkim-enabled \
  --identity postolio.example \
  --dkim-enabled \
  --region us-east-1
```

Add the CNAME records to your DNS for better deliverability.

### 4. Move Out of Sandbox (Production)

New AWS accounts start in sandbox mode with limitations:
- Can only send to verified emails
- Max 200 emails/day
- Max 1 email/second

To request production access:
1. Go to [AWS SES Console](https://console.aws.amazon.com/ses/)
2. Click "Request production access"
3. Fill out the form with:
   - Use case: Transactional emails (password resets, verifications)
   - Expected volume: 1,000-10,000 emails/month
   - Bounce handling: Automated via AWS SNS

### 5. Set Up SNS for Bounce Handling (Optional)

```bash
# Create SNS topic
aws sns create-topic --name ses-bounces --region us-east-1

# Subscribe your email
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:YOUR_ACCOUNT:ses-bounces \
  --protocol email \
  --notification-endpoint admin@postolio.example
```

## Environment Configuration

### Development (.env)

```bash
# Use SMTP for local development
USE_AWS_SES=false
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### Production (AWS)

```bash
# Use SES in production (set automatically by CDK)
USE_AWS_SES=true
AWS_REGION=us-east-1
SES_FROM_EMAIL=noreply@postolio.example
NODE_ENV=production
```

## IAM Permissions

The ECS task role needs these SES permissions (already configured in CDK):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:GetIdentityVerificationAttributes",
        "ses:VerifyEmailIdentity"
      ],
      "Resource": "*"
    }
  ]
}
```

## Testing

### Test Email Sending

```bash
# Test with AWS CLI
aws ses send-email \
  --from noreply@postolio.example \
  --to test@example.com \
  --subject "Test Email" \
  --text "This is a test email from Postolio" \
  --region us-east-1
```

### Test in Application

```javascript
// The EmailService automatically uses SES in production
import { EmailService } from './services/email.js'

// Send test email
const result = await EmailService.sendEmail({
  to: 'user@example.com',
  subject: 'Test Email',
  html: '<p>Test email from Postolio</p>',
  text: 'Test email from Postolio'
})
```

## Monitoring

### Check Sending Statistics

```bash
aws ses describe-configuration-set \
  --configuration-set-name default \
  --region us-east-1
```

### View Send Quota

```bash
aws ses get-send-quota --region us-east-1
```

### Check Reputation

```bash
aws ses get-account-sending-enabled --region us-east-1
```

## Common Issues

### Email Not Verified Error

```
MessageRejected: Email address is not verified
```

**Solution**: Verify the sender email address:
```bash
aws ses verify-email-identity --email-address noreply@postolio.example
```

### Sandbox Limitations

```
MessageRejected: Email address is not verified. The following identities failed the check
```

**Solution**: Either:
1. Verify recipient emails for testing
2. Request production access

### DNS Not Propagated

Domain verification pending for more than 72 hours.

**Solution**: 
1. Check DNS records are correctly added
2. Use `dig` to verify: `dig TXT _postolio.example`

### Rate Exceeded

```
Throttling: Rate exceeded
```

**Solution**: Implement exponential backoff or use SES configuration sets for better rate management.

## Best Practices

1. **Always verify sender addresses** before sending
2. **Handle bounces and complaints** to maintain sender reputation
3. **Use configuration sets** for tracking and analytics
4. **Implement retry logic** with exponential backoff
5. **Monitor your sender reputation** regularly
6. **Use dedicated IPs** for high-volume sending (optional)

## Cost Optimization

- **Free Tier**: 62,000 emails/month when sent from EC2
- **Standard Pricing**: $0.10 per 1,000 emails
- **Attachments**: Charged per GB of attachments

## Support

For issues with SES setup:
1. Check CloudWatch logs in AWS Console
2. Review [AWS SES Documentation](https://docs.aws.amazon.com/ses/)
3. Contact AWS Support if needed

## Implementation Status

✅ **Completed**:
- EmailService with SES integration
- Automatic SES/SMTP switching based on environment
- IAM permissions in CDK stack
- Setup automation script
- Error handling and fallback

🚀 **Ready for Production**: The email system automatically uses SES when deployed to AWS.