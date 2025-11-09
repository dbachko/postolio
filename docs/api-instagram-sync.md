# Instagram Post Sync API Documentation

**Last Updated**: January 2025

## Overview

The Instagram Post Sync feature allows users to import their published Instagram posts into Postolio, making them available in the Timeline and Calendar views alongside generated content.

## Key Features

- ✅ **Automatic Initial Sync**: Triggered when user connects Instagram account
- ✅ **Manual Sync**: Users can trigger sync via UI button
- ✅ **Image Persistence**: Downloads images from Instagram and stores in S3 with CDN URLs
- ✅ **Rate Limiting**: 15-minute cooldown between syncs
- ✅ **Duplicate Prevention**: Skips posts already imported
- ✅ **Smart Limits**: Syncs up to 100 posts OR 30 days of history (whichever is smaller)
- ✅ **Graceful Degradation**: Stores posts even if image download fails
- ✅ **Comprehensive Monitoring**: Structured logs with performance metrics

## API Endpoints

### 1. Sync Instagram Posts

Imports published Instagram posts into the database.

**Endpoint**: `POST /api/instagram/sync-posts/:brandId`

**Authentication**: Required (JWT)

**Rate Limit**: 15-minute cooldown per brand

**Request Parameters**:

```typescript
// Path Parameters
brandId: string; // Brand ID to sync for

// Body Parameters (optional)
{
  maxPosts?: number;  // Max posts to sync (default: 100)
  maxDays?: number;   // Max days of history (default: 30)
}
```

**Response**:

```typescript
{
  success: boolean;
  results: {
    synced: number;    // Successfully imported posts
    skipped: number;   // Already existing posts
    failed: number;    // Failed imports
    errors?: string[]; // Error messages (if any)
  };
  message: string;     // Human-readable summary
}
```

**Success Example** (200):

```json
{
  "success": true,
  "results": {
    "synced": 47,
    "skipped": 3,
    "failed": 0
  },
  "message": "Synced 47 posts, skipped 3, failed 0"
}
```

**Error Examples**:

Rate Limited (429):

```json
{
  "error": "Sync already in progress or completed recently",
  "message": "Please wait 12 more minutes before syncing again",
  "retryAfter": "2025-01-15T10:30:00.000Z"
}
```

Not Connected (400):

```json
{
  "error": "Instagram not connected for this brand"
}
```

### 2. Get Sync Status

Returns current sync status including cooldown and last sync results.

**Endpoint**: `GET /api/instagram/sync-status/:brandId`

**Authentication**: Required (JWT)

**Request Parameters**:

```typescript
// Path Parameters
brandId: string; // Brand ID to check status for
```

**Response**:

```typescript
{
  canSync: boolean;           // Whether sync is currently allowed
  cooldownRemaining: number;  // Seconds until next sync (0 if can sync)
  lastSync: {
    timestamp: string;        // ISO 8601 timestamp of last sync
    duration: number;         // Sync duration in milliseconds
    results: {
      synced: number;
      skipped: number;
      failed: number;
      errors: string[];
    };
    options: {
      maxPosts: number;
      maxDays: number;
    };
  } | null;
  instagram: {
    connected: boolean;       // Instagram connection status
    accountId: string | null; // Instagram account ID
  };
}
```

**Example Response**:

```json
{
  "canSync": false,
  "cooldownRemaining": 720,
  "lastSync": {
    "timestamp": "2025-01-15T10:15:30.000Z",
    "duration": 12450,
    "results": {
      "synced": 47,
      "skipped": 3,
      "failed": 0,
      "errors": []
    },
    "options": {
      "maxPosts": 100,
      "maxDays": 30
    }
  },
  "instagram": {
    "connected": true,
    "accountId": "17841405309211844"
  }
}
```

## Implementation Details

### Sync Process Flow

1. **Validation**: Check Instagram connection and brand ownership
2. **Cooldown Check**: Verify 15-minute cooldown has elapsed
3. **Set Cooldown**: Mark sync start time in Redis
4. **Fetch Posts**: Paginate through Instagram Graph API (max 100 per request)
5. **Filter by Date**: Only process posts within last 30 days
6. **Process Each Post**:
   - Check for duplicates via `ContentPublication` (platform + `external_post_id`)
   - Download image from Instagram URL
   - Upload to S3 with metadata
   - Create Content record with `status='published'`
   - Store engagement metrics (likes, comments)
7. **Store Metadata**: Save sync results to Redis (24-hour TTL)
8. **Return Results**: Send summary to client

### Image Handling

Images are downloaded from Instagram and uploaded to S3 for permanent storage:

```typescript
// Image import helper uses a content-scoped ID; external post ID is stored on ContentPublication
{
  contentId: `import-${external_post_id}`,
  brandId: string,
  generatedAt: Date,
  source: 'instagram',
  originalPrompt: string
}
```

**Graceful Failure**: If image download fails, post is still stored without image. The `generationParams` field includes `imageDownloadFailed: true` for tracking.

### Duplicate Prevention

Posts are identified by a `ContentPublication` with `platform='instagram'` and the media's `external_post_id`:

```sql
SELECT p.*
FROM content_publications p
JOIN content c ON c.id = p.content_id
WHERE c.brand_id = ?
  AND p.platform = 'instagram'
  AND p.external_post_id = ?
LIMIT 1
```

If found, the post is skipped and counted in `results.skipped`.

Additionally, when an imported Instagram post does not yet exist, the sync attempts to detect and update an existing draft/scheduled post for the same brand to avoid duplicates. Matching uses:

- Scheduled time proximity (±2 hours compared to the Instagram `timestamp`), and
- Caption similarity (normalized exact match or prefix match)

When a match is found, the existing content is updated to `status='published'` and a `ContentPublication` is upserted with `external_post_id`, `permalink`, and `publishedAt`. Existing image data is preserved if present; otherwise the imported image (if downloaded) is set. Import metadata is added to `generationParams` with `source='instagram_import'`.

### Rate Limiting

Implemented with Redis:

```typescript
// Cooldown key
const key = `instagram_sync:${brandId}`;

// Check cooldown
const lastSync = await redisService.get(key);
const cooldownMs = 15 * 60 * 1000; // 15 minutes

// Set cooldown
await redisService.set(key, Date.now().toString(), 900); // 15 min TTL
```

### Monitoring & Logging

All sync operations emit structured logs with emojis for easy scanning:

```typescript
[Instagram Sync] Started for brand ${brandId}
[Instagram Sync] 📥 Fetched 47 posts for brand ${brandId}
[Instagram Sync] 🖼️  Image uploaded to S3: ai-images/...
[Instagram Sync] ✨ Synced post ${postId}
[Instagram Sync] ❌ Failed to sync post ${postId}
[Instagram Sync] ⚠️  Failed to download image for post ${postId}
[Instagram Sync] ✅ Completed for brand ${brandId}
```

**Metrics Logged**:

- Total duration (ms and seconds)
- Success rate (%)
- Posts per second
- Individual post timings
- Image upload duration
- Engagement data (likes, comments)

## Frontend Integration

### InstagramSyncButton Component

Location: `packages/apps/web/src/components/InstagramSyncButton.tsx`

**Usage**:

```tsx
import { InstagramSyncButton } from './InstagramSyncButton';

<InstagramSyncButton
  brandId={brand.id}
  variant="outline" // optional: button style
  size="default" // optional: button size
  className="" // optional: additional classes
/>;
```

**Features**:

- Loading states with progress indicators
- Toast notifications for all states:
  - Success: Shows synced/skipped/failed counts
  - Info: All posts already imported
  - Warning: Rate limit with countdown
  - Error: Connection or API errors
- Automatic query invalidation (Calendar & Content)

### API Client Method

Location: `packages/apps/web/src/lib/api.ts`

```typescript
async syncInstagramPosts(
  brandId: string,
  options: { maxPosts?: number; maxDays?: number }
): Promise<{
  success: boolean;
  results: {
    synced: number;
    skipped: number;
    failed: number;
    errors?: string[];
  };
  message: string;
}>
```

## Database Schema (Updated)

We no longer store Instagram identifiers or analytics on the `Content` entity. Instead, each post publication is persisted in `ContentPublication`, and analytics are stored as samples and latest rollups.

```prisma
model Content {
  id            String   @id @default(cuid())
  brandId       String
  caption       String
  hashtags      String[]
  status        String
  postedAt      DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  publications  ContentPublication[]
}

model ContentPublication {
  id               String   @id @default(cuid())
  contentId        String
  socialAccountId  String
  platform         Platform
  externalPostId   String
  permalink        String?
  publishedAt      DateTime?
  status           String?
  metricsLatest    PublicationMetricsLatest?
  metricSamples    MetricSample[]
}
```

### Generation Params Structure (for imported posts)

```json
{
  "source": "instagram_import",
  "importedAt": "2025-01-15T10:15:30.000Z",
  "originalPostDate": "2025-01-10T14:22:00.000Z",
  "mediaType": "IMAGE",
  "hasImage": true,
  "imageDownloadFailed": false
}
```

Analytics are persisted as `MetricSample` (append-only) and `PublicationMetricsLatest` (fast reads). Use the new API under `/api/analytics/*` to fetch metrics and refresh as needed.

## Error Handling

### Common Errors

| Error                   | Status | Description                             | Solution                     |
| ----------------------- | ------ | --------------------------------------- | ---------------------------- |
| Instagram not connected | 400    | Brand doesn't have Instagram configured | Connect Instagram first      |
| Rate limited            | 429    | Sync requested within cooldown period   | Wait for cooldown to expire  |
| Brand not found         | 404    | Invalid brandId or access denied        | Check brand ownership        |
| Unsupported media type  | -      | Video or non-image post                 | Skipped automatically        |
| Image download failed   | -      | Instagram image URL expired/invalid     | Post saved without image     |
| API rate limit          | 429    | Instagram Graph API limit reached       | Automatic retry with backoff |
| Token expired           | 401    | Instagram access token invalid          | Automatic token refresh via  |
|                         |        |                                         | Token Service                |

### Retry Logic

- **Image downloads**: Single attempt, graceful failure
- **Post creation**: No retry, errors are logged and counted
- **Full sync**: No automatic retry, user must trigger manually

## Performance

### Expected Sync Times

| Posts | Duration | Notes                |
| ----- | -------- | -------------------- |
| 10    | ~3-5s    | Typical recent posts |
| 50    | ~15-20s  | Medium sync          |
| 100   | ~30-40s  | Full sync (max)      |

**Factors**:

- Image download speeds (Instagram CDN)
- S3 upload speeds
- Database write performance
- Network latency

### Rate Limits

- **Instagram Graph API**: 200 requests/hour per app
- **Sync Cooldown**: 15 minutes per brand
- **Post Pagination**: 100 posts per request (API max)

## Testing

See `docs/product-spec-instagram-post-sync.md` for comprehensive test scenarios including:

- ✅ First-time sync
- ✅ Incremental sync
- ✅ Rate limiting
- ✅ Error handling
- ✅ Timeline/Calendar integration
- ✅ OAuth flow

## Security

- **Authentication**: All endpoints require valid JWT
- **Authorization**: Brand ownership validated on every request
- **Rate Limiting**: Per-brand cooldown prevents abuse
- **Token Storage**: Instagram tokens stored in Token Service with encryption
- **CSRF Protection**: All POST requests require CSRF token

## Support

For issues or questions:

1. Check structured logs: `[Instagram Sync]` prefix
2. Verify Instagram connection status
3. Check sync status endpoint for detailed info
4. Review CloudWatch logs for production issues

## Related Documentation

- Product Spec: `docs/product-spec-instagram-post-sync.md`
- Implementation Plan: `docs/implementation-plan-instagram-post-sync.md`
- Main README: `CLAUDE.md`
