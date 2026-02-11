# Multi-Provider Image Generation System

**Version**: 1.0.0
**Last Updated**: January 2025
**Status**: Production Ready

## Overview

The multi-provider image generation system allows Postolio to generate AI images using multiple providers (Google Gemini, DALL-E) with automatic fallback, cost tracking, and analytics.

## Features

✅ **3 AI Providers Supported**:

- Google Gemini 2.5 Flash (recommended, $0.039/img)
- Google Gemini 3 Pro ($0.15/img)
- DALL-E 3 ($0.04/img)

✅ **Two-Tier Provider Selection**:

1. Brand-level preference (highest priority)
2. System default (Gemini Flash)

✅ **Cost Tracking & Analytics**:

- Per-brand analytics dashboard
- Provider performance comparison
- Recent generation logs
- Cost optimization insights

✅ **Production Features**:

- Automatic provider fallback on failures
- Database logging for all generations
- Brand context enhancement (tones, color palettes)
- Configurable per-brand

## Architecture

### Backend Components

```
packages/apps/api/src/services/image-providers/
├── types.ts              # Core type definitions
├── base-provider.ts      # Abstract base class
├── registry.ts           # Provider singleton registry
├── orchestrator.ts       # Generation orchestrator with fallback
├── dalle-provider.ts     # OpenAI DALL-E 3 implementation
├── gemini-flash-provider.ts   # Google Gemini 2.5 Flash
└── gemini-pro-provider.ts     # Google Gemini 3 Pro
```

### API Endpoints

| Endpoint                                   | Method | Auth | Description                        |
| ------------------------------------------ | ------ | ---- | ---------------------------------- |
| `/api/image-providers`                     | GET    | No   | List all configured providers      |
| `/api/image-providers/:brandId/preference` | GET    | Yes  | Get brand's provider preference    |
| `/api/image-providers/:brandId/preference` | POST   | Yes  | Update brand's provider preference |
| `/api/image-providers/:brandId/analytics`  | GET    | Yes  | Get cost and usage analytics       |

### Database Schema

```prisma
model ImageGenerationLog {
  id             String   @id @default(cuid())
  brandId        String
  contentId      String?
  provider       String   // Provider used
  prompt         String   @db.Text
  imageUrl       String
  cost           Decimal  @db.Decimal(10, 4)
  generationTime Int      // milliseconds
  size           String
  quality        String?
  status         String   @default("success")
  failedProvider String?  // If fallback was used
  metadata       Json?
  createdAt      DateTime @default(now())

  @@index([brandId, createdAt])
  @@index([provider, createdAt])
  @@map("image_generation_logs")
}
```

## Deployment

### 1. Environment Variables

Add API keys for desired providers to your `.env` file:

```bash
# OpenAI (DALL-E 3)
OPENAI_API_KEY=sk-proj-...

# Google AI (Gemini Flash & Pro)
GOOGLE_GENERATIVE_AI_API_KEY=AIza...

# Optional routing controls
DEFAULT_IMAGE_PROVIDER=gemini-2.5-flash
IMAGE_FALLBACK_ORDER=gemini-2.5-flash,dalle-3,gemini-3-pro
```

**Note**: Only providers with configured API keys will be available.

### 2. Database Migration

Run the migration to create the `ImageGenerationLog` table:

```bash
cd packages/libs/database
pnpm prisma migrate deploy
```

### 3. AWS Secrets Manager (Production)

For production deployment, store API keys in AWS Secrets Manager:

```bash
# Create secret
aws secretsmanager create-secret \
  --name postolio/image-providers \
  --secret-string '{
    "OPENAI_API_KEY": "sk-proj-...",
    "GOOGLE_GENERATIVE_AI_API_KEY": "AIza..."
  }'
```

Update your CDK stack to inject these secrets as environment variables.

### 4. CDK Deployment

The image provider system is included in existing stacks:

```bash
cd packages/infra/cdk

# Deploy API stack (includes provider routes)
pnpm cdk deploy API-dev

# Deploy Web stack (includes analytics UI)
pnpm cdk deploy Web-dev
```

### 5. Verify Deployment

Check that providers are configured:

```bash
curl https://your-api-domain.com/api/image-providers
```

Expected response:

```json
{
  "providers": [
    {
      "name": "gemini-2.5-flash",
      "displayName": "Gemini 2.5 Flash",
      "isConfigured": true,
      "pricing": {
        "standard": 0.039,
        "speedEstimate": "5-10s",
        "features": ["Superior text rendering", "Fast generation"]
      }
    }
  ],
  "default": "gemini-2.5-flash"
}
```

## Usage

### Brand Preference (Frontend)

Users select an image provider at the brand level:

1. Navigate to **Settings → Brand Settings**
2. Find **AI Image Provider**
3. Select preferred provider or "Use system default"
4. System uses brand preference > system default

### Brand Settings

Set a default provider for a brand:

1. Navigate to **Settings → Brand Settings**
2. Scroll to **AI Image Provider** card
3. Select preferred provider or "Use system default"
4. Click **Save Brand Settings**

### Analytics

View image generation analytics:

1. Navigate to **Settings → Analytics**
2. View metrics:
   - Total images generated
   - Total cost across providers
   - Average cost per image
   - Provider performance comparison
   - Recent generation logs

## Cost Optimization

### Recommended Provider

**Gemini 2.5 Flash** is the system default and offers the best value:

- **Cost**: $0.039/image (lowest)
- **Speed**: 5-10s (fast)
- **Quality**: High, with superior text rendering
- **Features**: Multi-turn refinement, character consistency

### Cost Comparison

| Provider         | Cost/Image | Speed  | Best For                        |
| ---------------- | ---------- | ------ | ------------------------------- |
| Gemini 2.5 Flash | $0.039     | 5-10s  | General use, text-heavy images  |
| DALL-E 3         | $0.040     | 10-20s | High-quality, detailed images   |
| Gemini 3 Pro     | $0.150     | 10-15s | Complex scenes, highest quality |

### Tips

1. **Set brand defaults**: Configure preferred provider in brand settings
2. **Monitor analytics**: Review cost dashboard to identify expensive usage
3. **Use fallback**: Enable automatic fallback to avoid failures
4. **Batch generations**: Reduce retries and regenerate less where possible

## Monitoring

### CloudWatch Metrics

Track image generation metrics:

- Total generations per hour
- Average cost per generation
- Provider failures and fallbacks
- Generation time distribution

### Database Queries

Query generation logs for insights:

```sql
-- Cost by provider (last 30 days)
SELECT
  provider,
  COUNT(*) as count,
  SUM(cost) as total_cost,
  AVG(cost) as avg_cost,
  AVG(generation_time) as avg_time_ms
FROM image_generation_logs
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY provider
ORDER BY total_cost DESC;

-- Failed generations
SELECT *
FROM image_generation_logs
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 10;
```

## Troubleshooting

### No Providers Configured

**Symptom**: Error "No image providers configured"
**Solution**: Add at least one provider API key to environment variables

### Provider API Failures

**Symptom**: Images fail to generate
**Solution**:

1. Check API key validity
2. Verify API quota limits
3. Enable fallback in orchestrator
4. Review CloudWatch logs

### High Costs

**Symptom**: Unexpected high image generation costs
**Solution**:

1. Review analytics dashboard
2. Identify brands using expensive providers
3. Update brand defaults to Gemini Flash
4. Educate users on provider selection

### Slow Generation

**Symptom**: Image generation takes too long
**Solution**:

1. Switch to faster provider (Gemini Flash)
2. Check API rate limits
3. Verify network latency to provider APIs

## Testing

### Unit Tests

```bash
pnpm --filter api test -- src/services/image-providers/__tests__/base-provider.test.ts
```

### Integration Tests

```bash
pnpm --filter api test -- src/routes/__tests__/image-providers.test.ts
```

### Manual Testing

1. Create a test post with AI images
2. Try different providers
3. Verify images generate correctly
4. Check analytics dashboard updates
5. Test brand preference persistence

## Maintenance

### Adding New Providers

1. Create provider class extending `BaseImageProvider`
2. Implement `generateImage()` method
3. Register in `registry.ts`
4. Add to TypeScript `ImageProvider` enum
5. Update frontend UI with new option
6. Document pricing and features

### Updating Provider Pricing

Update pricing in provider classes:

```typescript
readonly pricing: ProviderPricing = {
  standard: 0.039, // Update here
  speedEstimate: '5-10s',
  features: [...],
};
```

### Database Maintenance

Periodically archive old generation logs:

```sql
-- Archive logs older than 90 days
DELETE FROM image_generation_logs
WHERE created_at < NOW() - INTERVAL '90 days';
```

## Security

- ✅ API keys stored in AWS Secrets Manager (production)
- ✅ Authentication required for brand preferences
- ✅ Ownership validation on all brand operations
- ✅ Input validation on all endpoints
- ✅ No API keys exposed to frontend

## Support

For issues or questions:

- Review this documentation
- Check CloudWatch logs
- Query `image_generation_logs` table
- Contact development team

---

**Implementation Date**: January 2025
**Next Review**: April 2025
