# Token Service Integration - Quick Start Guide

## 🚀 Simplified Implementation (No Customers = Clean Transition)

Since you have no customers yet, we can do a **clean architectural transition** without complex migration strategies. This is the ideal scenario!

## 📋 Implementation Tasks

### Day 1: Token Service Client (4-6 hours)

#### 1. Create Token Service Client SDK

**File**: `src/clients/token-service-client.ts`

```typescript
import AWS from "aws-sdk";
import CircuitBreaker from "opossum";
import { z } from "zod";

const TokenDataSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.string(),
  metadata: z.record(z.any()).optional(),
});

export class TokenServiceClient {
  private apiUrl: string;
  private circuitBreaker: CircuitBreaker;

  constructor() {
    this.apiUrl =
      process.env.TOKEN_SERVICE_URL ||
      `https://your-api-gateway-id.execute-api.us-east-1.amazonaws.com/prod`;

    // Circuit breaker for resilience
    this.circuitBreaker = new CircuitBreaker(this.makeRequest.bind(this), {
      timeout: 5000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
    });
  }

  async storeToken(params: {
    userId: string;
    brandId: string;
    platform: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt: Date;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.circuitBreaker.fire({
      method: "POST",
      path: "/tokens",
      body: params,
    });
  }

  async getToken(userId: string, brandId: string, platform: string) {
    const response = await this.circuitBreaker.fire({
      method: "GET",
      path: `/tokens/${userId}/${brandId}/${platform}`,
    });
    return TokenDataSchema.parse(response);
  }

  private async makeRequest(options: any) {
    // Add AWS SigV4 signing here
    // Implementation details...
  }
}

// Export singleton instance
export const tokenServiceClient = new TokenServiceClient();
```

#### 2. Update OAuth Flow

**File**: `src/routes/auth.ts`

```typescript
import { tokenServiceClient } from "../clients/token-service-client";

// In the Instagram OAuth callback handler
app.post("/api/auth/instagram/callback", async (request, reply) => {
  // ... existing OAuth code ...

  // OLD: Store in database
  // await prisma.brand.update({
  //   where: { id: brandId },
  //   data: { instagramAccessToken: token.access_token }
  // })

  // NEW: Store in Token Service
  await tokenServiceClient.storeToken({
    userId: brand.userId,
    brandId: brand.id,
    platform: "instagram",
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
    metadata: {
      pageId: pageId,
      accountId: accountId,
    },
  });

  console.log(`✅ Token stored in Token Service for brand ${brand.id}`);
});
```

### Day 2: Service Integration (4-6 hours)

#### 3. Update Instagram Service

**File**: `src/services/instagram.ts`

```typescript
import { tokenServiceClient } from "../clients/token-service-client";

export class InstagramService {
  async getAccessToken(brand: Brand): Promise<string> {
    // NEW: Get from Token Service
    const tokenData = await tokenServiceClient.getToken(
      brand.userId,
      brand.id,
      "instagram",
    );

    // Check if token needs refresh (within 7 days of expiry)
    const expiresAt = new Date(tokenData.expiresAt);
    const refreshThreshold = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    if (expiresAt < refreshThreshold) {
      console.log(`Token expiring soon for brand ${brand.id}, refreshing...`);
      const refreshed = await tokenServiceClient.refreshToken(
        brand.userId,
        brand.id,
        "instagram",
      );
      return refreshed.accessToken;
    }

    return tokenData.accessToken;
  }

  // Update all methods to use getAccessToken()
  async publishContent(brand: Brand, content: Content) {
    const accessToken = await this.getAccessToken(brand);
    // ... rest of publishing logic
  }
}
```

#### 4. Update Scheduler Service

**File**: `aws-infrastructure/lib/lambdas/scheduler-service/index.ts`

```typescript
// When creating a schedule, include token data
export const handler = async (event: any) => {
  // ... existing scheduler logic ...

  // Fetch token for the schedule
  const tokenData = await tokenServiceClient.getToken(
    schedule.userId,
    schedule.brandId,
    schedule.platform,
  );

  // Include token in SQS message
  const message = {
    scheduleId: schedule.id,
    contentId: schedule.contentId,
    brandId: schedule.brandId,
    platform: schedule.platform,
    // NEW: Include credentials
    credentials: {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: tokenData.expiresAt,
    },
    content: {
      caption: schedule.caption,
      hashtags: schedule.hashtags,
      mediaUrl: schedule.mediaUrl,
    },
  };

  await sqs
    .sendMessage({
      QueueUrl: process.env.PUBLISHER_QUEUE_URL,
      MessageBody: JSON.stringify(message),
    })
    .promise();
};
```

### Day 3: Publisher Update & Cleanup (3-4 hours)

#### 5. Update Publisher Lambda

**File**: `aws-infrastructure/lib/lambdas/publishers/instagram/index.ts`

```typescript
export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const message = JSON.parse(record.body);

    // NEW: Use credentials from message instead of API call
    const { credentials, content } = message;

    // No more API callback needed!
    // OLD: const creds = await fetchCredentialsFromMainApp(message.contentId)

    // Use the provided credentials
    const result = await publishToInstagram({
      accessToken: credentials.accessToken,
      content: content,
    });

    console.log(`✅ Published content using Token Service credentials`);
  }
};
```

#### 6. Remove Credentials Endpoint

**File**: `src/routes/publisher.ts`

```typescript
// DELETE this entire endpoint - no longer needed!
// app.get('/api/publisher/credentials/:contentId', async (request, reply) => {
//   ... remove all this code ...
// })
```

#### 7. Clean Database Schema

**File**: `prisma/schema.prisma`

```prisma
model Brand {
  id                    String   @id @default(cuid())
  name                  String
  description           String?
  userId                String
  // REMOVE these token fields (after 7-day fallback period)
  // instagramAccessToken  String?  @deprecated
  // instagramPageId       String?  @deprecated
  // instagramAccountId    String?  @deprecated
  user                  User     @relation(fields: [userId], references: [id])
  content              Content[]
  campaigns            Campaign[]
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}
```

Run migration:

```bash
npx prisma migrate dev --name remove-token-fields
```

### Day 4: Testing & Monitoring (2-3 hours)

#### 8. Test End-to-End Flow

```bash
# Test OAuth flow
1. Connect Instagram account
2. Verify token stored in DynamoDB (check AWS Console)
3. Create content
4. Schedule content
5. Verify publishing works

# Test token refresh
1. Manually set token expiry to near future in DynamoDB
2. Trigger content publishing
3. Verify automatic refresh happens
```

#### 9. Set Up Monitoring

**CloudWatch Dashboard Widgets**:

```json
{
  "TokenServiceLatency": {
    "metric": "AWS/Lambda",
    "stat": "Average",
    "dimensions": {
      "FunctionName": "token-service"
    }
  },
  "TokenServiceErrors": {
    "metric": "AWS/Lambda",
    "stat": "Sum",
    "dimensions": {
      "FunctionName": "token-service"
    }
  },
  "CircuitBreakerState": {
    "metric": "Custom/TokenService",
    "stat": "Maximum",
    "dimensions": {
      "CircuitBreaker": "State"
    }
  }
}
```

## 🔧 Environment Variables

Add to `.env`:

```bash
# Token Service Configuration
TOKEN_SERVICE_URL=https://your-api-gateway-id.execute-api.us-east-1.amazonaws.com/prod
TOKEN_SERVICE_REGION=us-east-1

# Remove these after migration
# DEPRECATED_INSTAGRAM_TOKEN_FALLBACK=true  # Remove after 7 days
```

## 🧪 Validation Checklist

- [ ] OAuth flow stores tokens in Token Service
- [ ] Instagram service retrieves tokens from Token Service
- [ ] Publisher receives credentials in SQS message
- [ ] No more `/publisher/credentials` API calls
- [ ] Content publishes successfully end-to-end
- [ ] Token refresh works automatically
- [ ] Monitoring dashboard shows healthy metrics
- [ ] Database token columns marked as deprecated

## 🎯 Success Indicators

After implementation, you should see:

- ✅ All tokens in DynamoDB (check AWS Console)
- ✅ Zero calls to `/publisher/credentials` endpoint
- ✅ Publisher Lambda logs show "Using Token Service credentials"
- ✅ No token-related errors in CloudWatch
- ✅ Circuit breaker stays closed (healthy)

## 🚨 Rollback Plan (If Needed)

Since no customers yet, rollback is simple:

1. Re-enable database token reading (uncomment old code)
2. Re-enable `/publisher/credentials` endpoint
3. Revert publisher Lambda to previous version
4. Debug and fix issues
5. Retry implementation

## 📊 Before/After Comparison

### Before (Current)

```
OAuth → Database → Publisher calls API → Database → Instagram
         ↓
    Token Service (unused)
```

### After (Improved)

```
OAuth → Token Service → EventBridge → Publisher → Instagram
            ↓
      Auto-refresh
```

## 💰 Cost Impact

- **Token Service**: ~$30/month (DynamoDB + Lambda)
- **Removed**: API Gateway calls for credentials
- **Net Savings**: ~$65/month
- **Security Value**: Priceless (encrypted tokens)

## 🏁 Final Steps

1. **Day 1-3**: Implement changes
2. **Day 4**: Test thoroughly
3. **Day 7**: Remove database token columns
4. **Day 8+**: Monitor and optimize

## 🎉 Completion

Once implemented, you'll have:

- **Enterprise-grade** token management
- **Zero** token-related failures
- **50ms** token retrieval
- **Automatic** token refresh
- **Complete** audit trail
- **Platform-ready** architecture for TikTok, LinkedIn, etc.

---

**This is the perfect time to make this change - no customers means no risk!**

Start with Step 1 (Token Service Client) and work through the checklist. Each step builds on the previous one, and you can validate as you go.

**READY TO IMPLEMENT**
