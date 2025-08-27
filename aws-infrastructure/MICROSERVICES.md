# Postolio Platform Microservices Architecture

## Overview

The Postolio Platform Microservices is a production-ready, event-driven architecture for social media scheduling and publishing. Built with AWS serverless technologies, it provides scalable, reliable, and secure content publishing across multiple social media platforms.

## Architecture Components

### Core Services

1. **Token Service** - OAuth token management with encryption
2. **Scheduler Service** - Content scheduling with EventBridge
3. **Publisher Services** - Platform-specific publishing (Instagram, Facebook, LinkedIn, TikTok)
4. **Token Rotation** - Automated token refresh

### Infrastructure

- **DynamoDB Tables**: Token storage, schedule management, job states, idempotency
- **EventBridge**: Event-driven orchestration
- **SQS Queues**: Reliable message processing with DLQ
- **API Gateway**: RESTful API with rate limiting
- **KMS**: Token encryption at rest
- **Secrets Manager**: Platform API credentials
- **Lambda Functions**: Serverless compute with provisioned concurrency

## Deployment

### Prerequisites

```bash
# Install AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Configure AWS credentials
aws configure

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install CDK globally
npm install -g aws-cdk
```

### Quick Start

```bash
# Navigate to infrastructure directory
cd aws-infrastructure

# Validate the stack
./scripts/validate-microservices.sh dev

# Deploy to development
./scripts/deploy-microservices.sh dev

# Deploy to production with alerts
./scripts/deploy-microservices.sh prod your-email@example.com

# Test deployed services
./scripts/test-microservices.sh dev
```

### Manual Deployment

```bash
# Install dependencies
npm install

# Build Lambda layer
cd layers/shared/nodejs
npm install --production
cd ../../..

# Build TypeScript
npm run build

# Bootstrap CDK (first time only)
npx cdk bootstrap

# Deploy stack
npx cdk deploy Postolio-Platform-dev \
  --app "npx ts-node --prefer-ts-exts bin/platform-microservices.ts" \
  --context environment=dev

# View stack outputs
cat outputs-dev.json | jq
```

## API Endpoints

### Token Service

```bash
# Store a token
POST /tokens
{
  "userId": "user123",
  "brandId": "brand456",
  "platform": "instagram",
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": 1234567890000
}

# Get a token
GET /tokens/{userId}/{platform}

# Delete a token
DELETE /tokens/{userId}/{platform}
```

## Configuration

### Platform Secrets

After deployment, update the platform credentials in AWS Secrets Manager:

```bash
aws secretsmanager put-secret-value \
  --secret-id postolio/dev/platform-credentials \
  --secret-string '{
    "FACEBOOK_APP_ID": "your-app-id",
    "FACEBOOK_APP_SECRET": "your-app-secret",
    "INSTAGRAM_APP_ID": "your-app-id",
    "INSTAGRAM_APP_SECRET": "your-app-secret",
    "LINKEDIN_CLIENT_ID": "your-client-id",
    "LINKEDIN_CLIENT_SECRET": "your-client-secret",
    "TIKTOK_CLIENT_KEY": "your-client-key",
    "TIKTOK_CLIENT_SECRET": "your-client-secret"
  }'
```

## Monitoring

### CloudWatch Logs

```bash
# View token service logs
aws logs tail /aws/lambda/postolio-dev-token-service --follow

# View publisher logs
aws logs tail /aws/lambda/postolio-dev-instagram-publisher --follow

# Search for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/postolio-dev-token-service \
  --filter-pattern ERROR
```

### Metrics and Alarms

- DLQ message count
- Lambda errors and throttles
- API Gateway 4xx/5xx rates
- Token rotation failures

### Dead Letter Queue

```bash
# Check DLQ messages
aws sqs receive-message \
  --queue-url $(aws sqs get-queue-url \
    --queue-name postolio-dev-publisher-dlq \
    --query QueueUrl --output text)

# Purge DLQ (use with caution)
aws sqs purge-queue \
  --queue-url $(aws sqs get-queue-url \
    --queue-name postolio-dev-publisher-dlq \
    --query QueueUrl --output text)
```

## Event Flow

1. **Schedule Creation**: Client → API Gateway → Scheduler Lambda → EventBridge Schedule → DynamoDB
2. **Content Publishing**: EventBridge → SQS → Publisher Lambda → Social Platform API
3. **Token Refresh**: EventBridge Rule (daily) → Token Rotation Lambda → DynamoDB

## Security

### Encryption

- **At Rest**: DynamoDB encryption, KMS for tokens
- **In Transit**: HTTPS/TLS for all API calls
- **Secrets**: AWS Secrets Manager for API credentials

### IAM Policies

- Least privilege access for all Lambda functions
- Separate roles for each service
- No hardcoded credentials

### API Security

- Rate limiting: 50 req/s burst, 100 req/s sustained
- CORS configuration for web clients
- Request validation

## Troubleshooting

### Common Issues

1. **Token not found**
   - Check token exists in DynamoDB
   - Verify encryption key permissions
   - Check Lambda logs for errors

2. **Schedule not executing**
   - Verify EventBridge rule is enabled
   - Check SQS queue for messages
   - Review publisher Lambda logs

3. **API Gateway 403**
   - Check CORS configuration
   - Verify API key if required
   - Review rate limiting

### Debug Commands

```bash
# List EventBridge rules
aws events list-rules --event-bus-name postolio-dev-platform-events

# Describe a rule
aws events describe-rule --name InstagramScheduleRule

# Check Lambda function
aws lambda get-function --function-name postolio-dev-token-service

# Test Lambda locally
sam local invoke TokenService --event test-event.json
```

## Cost Optimization

### Recommendations

1. **DynamoDB**: Use on-demand billing for variable workloads
2. **Lambda**: Monitor cold starts, consider provisioned concurrency for critical functions
3. **CloudWatch**: Set appropriate log retention periods
4. **API Gateway**: Use caching where appropriate

### Cost Monitoring

```bash
# Get cost breakdown
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics "UnblendedCost" \
  --filter file://cost-filter.json
```

## Clean Up

```bash
# Destroy the stack (WARNING: This deletes all resources)
npx cdk destroy Postolio-Platform-dev \
  --app "npx ts-node --prefer-ts-exts bin/platform-microservices.ts"

# Manually clean up:
# - Secrets Manager secrets (have 7-day recovery period)
# - CloudWatch Log Groups (if retained)
# - DynamoDB backups (if any)
```

## Support

For issues or questions:
1. Check CloudWatch Logs for errors
2. Review this documentation
3. Check AWS service health dashboard
4. Contact the platform team

## Version History

- v1.0.0 - Initial microservices architecture
- v1.1.0 - Added Secrets Manager integration
- v1.2.0 - Implemented token encryption with KMS
- v1.3.0 - Added provisioned concurrency for publishers
- v1.4.0 - Optimized DynamoDB sharding for schedules