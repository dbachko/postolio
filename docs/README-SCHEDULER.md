# Content Scheduler Microservice Infrastructure

## Overview

AWS CDK infrastructure for the Postolio Content Scheduler microservice, handling 1M+ posts per day with 99.99% reliability.

## Architecture Components

### Core Services

- **EventBridge Scheduler**: Precise scheduling engine
- **Lambda Functions**: Serverless content publishing
- **DynamoDB**: Schedule storage with GDPR compliance
- **S3**: Video content storage with intelligent tiering
- **API Gateway**: RESTful API for schedule management

### Key Features

- ✅ 99.99% reliability with retry mechanisms
- ✅ Video content support (Instagram Reels, TikTok, YouTube Shorts)
- ✅ GDPR compliant with 90-day data retention
- ✅ Cost-optimized (~$450/month for 1M posts)
- ✅ Multi-platform support

## Deployment

### Prerequisites

```bash
# Install AWS CDK
npm install -g aws-cdk

# Configure AWS credentials
aws configure
```

### Deploy Infrastructure

```bash
# Deploy to development
./scripts/deploy-scheduler.sh dev

# Deploy to staging with alerts
./scripts/deploy-scheduler.sh staging alerts@example.com

# Deploy to production
./scripts/deploy-scheduler.sh prod alerts@example.com
```

### Environment Variables

After deployment, a `.env.scheduler` file is created with:

```env
SCHEDULER_API_ENDPOINT=https://xxx.execute-api.region.amazonaws.com/dev
SCHEDULER_SCHEDULES_TABLE=postolio-scheduler-dev-schedules
SCHEDULER_ENVIRONMENT=dev
```

## API Endpoints

### Schedule Management

```bash
# Create schedule
POST /schedules
{
  "brandId": "brand123",
  "contentId": "content456",
  "platform": "instagram",
  "scheduledAt": "2025-01-20T10:00:00Z",
  "contentType": "video",
  "videoUrl": "s3://bucket/video.mp4",
  "caption": "Check out our new product!",
  "hashtags": ["#newproduct", "#launch"]
}

# Get schedule
GET /schedules/{scheduleId}

# Update schedule
PUT /schedules/{scheduleId}

# Delete schedule
DELETE /schedules/{scheduleId}

# List schedules for brand
GET /schedules?brandId=brand123
```

## Lambda Functions

### Schedule Management Lambda

- Creates and manages content schedules
- Integrates with EventBridge for precise timing
- Handles CRUD operations

### Publisher Lambda

- Triggered by EventBridge at scheduled time
- Publishes content to social platforms
- Handles retry logic for failures

### Retry Handler Lambda

- Processes failed publishing attempts
- Implements exponential backoff
- Manages dead letter queue

## DynamoDB Schema

### Schedules Table

```
PK: SCHEDULE#{scheduleId}
SK: METADATA
GSI1PK: BRAND#{brandId}
GSI1SK: {scheduledAt}
GSI2PK: {status}
GSI2SK: {scheduledAt}
```

### Access Patterns

1. Get schedule by ID
2. List schedules by brand
3. Query schedules by status
4. Find schedules in time range

## Monitoring

### CloudWatch Dashboards

- Publishing success rate
- Scheduling latency
- Error rates by platform
- Cost tracking

### Alarms

- Publishing failures > 5 in 1 minute
- Retry queue > 100 items
- Lambda throttling
- DynamoDB throttling

## Cost Breakdown (Monthly)

| Service     | Cost      | Details                  |
| ----------- | --------- | ------------------------ |
| EventBridge | $0        | Free tier (1M schedules) |
| Lambda      | $180      | 1M invocations           |
| DynamoDB    | $150      | On-demand pricing        |
| S3          | $50       | Video storage            |
| API Gateway | $70       | API calls                |
| **Total**   | **~$450** | For 1M posts/month       |

## Security

### Encryption

- DynamoDB: AWS managed encryption
- S3: Server-side encryption
- Secrets: AWS Secrets Manager
- Transit: TLS 1.2+

### IAM Policies

- Least privilege access
- Service-specific roles
- No hardcoded credentials

### GDPR Compliance

- 90-day data retention
- Audit logging
- Right to deletion support
- Data encryption at rest

## Troubleshooting

### Common Issues

1. **Schedule not executing**
   - Check EventBridge rule status
   - Verify Lambda permissions
   - Check CloudWatch logs

2. **Publishing failures**
   - Check platform credentials in Secrets Manager
   - Verify retry queue processing
   - Monitor error metrics

3. **High costs**
   - Review Lambda duration metrics
   - Check DynamoDB consumption
   - Optimize S3 storage classes

## Next Steps

1. **Phase 2**: Platform connector implementation
2. **Phase 3**: Video processing pipeline
3. **Phase 4**: Monitoring dashboard setup
4. **Phase 5**: Load testing for 1M posts/day

## Support

For issues or questions, refer to:

- [Product Specification](../docs/content-scheduler-microservice.spec.md)
- Implementation Plan
