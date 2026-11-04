# Instagram Graph API Parameter Validation

## Overview

This document validates all parameters sent to the Instagram Graph API for different media types against Meta's official documentation.

**Last Updated**: January 2025
**API Version**: v23.0 (configurable via `API_VERSIONS.FACEBOOK_GRAPH`)

## Media Container Creation Parameters

### 1. Single Image Post

**Endpoint**: `POST /{ig-user-id}/media`

**Parameters We Send**:

| Parameter      | Type   | Required | Description                          | Status  |
| -------------- | ------ | -------- | ------------------------------------ | ------- |
| `image_url`    | string | ✅ Yes   | Publicly accessible URL of the image | ✅ Sent |
| `caption`      | string | ✅ Yes   | Caption text (max 2,200 chars)       | ✅ Sent |
| `access_token` | string | ✅ Yes   | User access token                    | ✅ Sent |

**Optional Parameters Available** (not currently sent):

- `location_id` - Location tag
- `user_tags` - Array of user tags (username + x/y coordinates)
- `product_tags` - Product catalog items (for shopping)

**Status**: ✅ **Fully Compliant** - All required parameters sent

---

### 2. Single Video/Reel Post

**Endpoint**: `POST /{ig-user-id}/media`

**Parameters We Send**:

| Parameter       | Type    | Required    | Description                          | Status      |
| --------------- | ------- | ----------- | ------------------------------------ | ----------- |
| `video_url`     | string  | ✅ Yes      | Publicly accessible URL of the video | ✅ Sent     |
| `media_type`    | string  | ✅ Yes      | "REELS" for reels/videos             | ✅ Sent     |
| `caption`       | string  | ⚪ Optional | Caption text                         | ✅ Sent     |
| `share_to_feed` | boolean | ⚪ Optional | Whether reel appears in feed         | ✅ Sent     |
| `thumb_offset`  | number  | ⚪ Optional | Thumbnail frame offset (ms)          | ✅ **NEW!** |
| `access_token`  | string  | ✅ Yes      | User access token                    | ✅ Sent     |

**Optional Parameters Available** (not currently sent):

- `cover_url` - Custom cover image URL (some APIs support this)
- `audio_name` - Audio track name for reels
- `location_id` - Location tag
- `user_tags` - User tags (username only, no coordinates for reels)

**Status**: ✅ **Fully Compliant** + Enhanced with `thumb_offset`

---

### 3. Story (Image or Video)

**Endpoint**: `POST /{ig-user-id}/media`

**Parameters We Send**:

| Parameter                  | Type   | Required    | Description       | Status  |
| -------------------------- | ------ | ----------- | ----------------- | ------- |
| `image_url` or `video_url` | string | ✅ Yes      | Media URL         | ✅ Sent |
| `media_type`               | string | ✅ Yes      | "STORIES"         | ✅ Sent |
| `access_token`             | string | ✅ Yes      | User access token | ✅ Sent |
| `thumb_offset`             | number | ⚪ Optional | For video stories | ✅ Sent |

**Note**: Stories don't support captions in the API.

**Status**: ✅ **Fully Compliant**

---

### 4. Carousel Post

**Endpoint for Container**: `POST /{ig-user-id}/media`

**Parameters We Send**:

| Parameter      | Type   | Required    | Description               | Status  |
| -------------- | ------ | ----------- | ------------------------- | ------- |
| `media_type`   | string | ✅ Yes      | "CAROUSEL"                | ✅ Sent |
| `caption`      | string | ⚪ Optional | Caption for carousel      | ✅ Sent |
| `children`     | string | ✅ Yes      | Comma-separated child IDs | ✅ Sent |
| `access_token` | string | ✅ Yes      | User access token         | ✅ Sent |

**Optional Parameters Available** (not currently sent):

- `location_id` - Location tag
- `product_tags` - Product catalog items

**Status**: ✅ **Fully Compliant**

---

### 5. Carousel Children (Images)

**Endpoint**: `POST /{ig-user-id}/media`

**Parameters We Send**:

| Parameter          | Type    | Required | Description       | Status  |
| ------------------ | ------- | -------- | ----------------- | ------- |
| `image_url`        | string  | ✅ Yes   | Image URL         | ✅ Sent |
| `is_carousel_item` | boolean | ✅ Yes   | "true"            | ✅ Sent |
| `access_token`     | string  | ✅ Yes   | User access token | ✅ Sent |

**Status**: ✅ **Fully Compliant**

---

### 6. Carousel Children (Videos)

**Method**: Resumable Upload

**Step 1 - Create Upload Session**:

| Parameter          | Type    | Required | Description       | Status  |
| ------------------ | ------- | -------- | ----------------- | ------- |
| `media_type`       | string  | ✅ Yes   | "VIDEO"           | ✅ Sent |
| `is_carousel_item` | boolean | ✅ Yes   | "true"            | ✅ Sent |
| `upload_type`      | string  | ✅ Yes   | "resumable"       | ✅ Sent |
| `access_token`     | string  | ✅ Yes   | User access token | ✅ Sent |

**Step 2 - Upload Video Data**:

- Uses `file_url` header with video CDN URL
- Resumable upload to Facebook rupload service

**Status**: ✅ **Fully Compliant** - Using Instagram's documented resumable upload flow

---

## Media Publishing Parameters

**Endpoint**: `POST /{ig-user-id}/media_publish`

**Parameters We Send**:

| Parameter      | Type   | Required | Description                | Status  |
| -------------- | ------ | -------- | -------------------------- | ------- |
| `creation_id`  | string | ✅ Yes   | Container ID from creation | ✅ Sent |
| `access_token` | string | ✅ Yes   | User access token          | ✅ Sent |

**Status**: ✅ **Fully Compliant**

---

## Structured Media Assets

We now send structured `mediaAssets` with explicit type information:

```typescript
interface MediaAsset {
  key: string; // S3 key or CDN URL
  type: 'image' | 'video'; // Explicit media type
  order: number; // Display order
  width?: number; // Asset dimensions
  height?: number;
  assetId?: string; // Asset service ID
  duration?: number; // Video duration (seconds)
}
```

This eliminates file extension guessing and ensures proper API parameter selection.

---

## Video Processing Wait Times

**Updated Configuration**:

- **Videos**: 15 minutes maximum wait time (up from 5 minutes)
- **Images**: 5 minutes maximum wait time
- **Poll Interval**: 60 seconds for all media types
- **Status Checks**: Up to 15 attempts for videos, 5 for images

**Rationale**: Instagram video processing can take 10-15 minutes depending on:

- Video length and resolution
- Server load
- Network conditions

---

## Parameter Sources

### From Content Model (Database):

- `caption`, `hashtags` → Caption assembly
- `contentType` → Determines media_type (post/reel/story)
- `mediaType` → Confirms image vs video
- `videoUrl` → Video CDN URL
- `shareToFeed` → Reel feed visibility
- `thumbOffset` → **NEW!** Video thumbnail selection
- `firstComment` → First comment text

### From MediaAssets (Database):

- `type` → Explicit image/video classification
- `order` → Carousel item ordering
- `width`, `height` → Asset dimensions
- `assetId` → Tracking identifier
- `duration` → Video length

### From Schedule/Request:

- `scheduledAt` → Publishing time
- `platform` → 'instagram'
- `userId` → User authorization

---

## Validation Flow

1. **Scheduler-Adapter** (`packages/apps/api/src/services/scheduler-adapter.ts`)
   - Extracts mediaAssets from Content
   - Determines media types using priority: `mediaType` > `contentType` > file extension
   - Includes thumbOffset if present
   - Sends to schedule-management

2. **Schedule-Management** (`packages/services/schedule-management/`)
   - Stores complete schedule with all parameters in DynamoDB
   - Triggers EventBridge for timed execution

3. **Publisher** (`packages/services/publisher/src/index.ts`)
   - Receives schedule with mediaAssets and thumbOffset
   - Creates media containers with appropriate parameters
   - Adds `thumb_offset` for video/reel containers
   - Waits for media processing
   - Publishes when ready

---

## Missing Optional Parameters

These parameters are supported by Instagram API but not currently implemented:

### Low Priority (Rarely Used):

- `location_id` - Geo-tagging posts
- `user_tags` - Tagging users in photos
- `product_tags` - Shopping/commerce tags
- `audio_name` - Custom audio for reels

### Not Supported by API:

- `cover_url` - Most APIs only support `thumb_offset` for video thumbnails

**Decision**: Focus on core publishing functionality. Optional tags can be added later if needed.

---

## Compliance Summary

✅ **All Required Parameters**: Sent correctly
✅ **Core Optional Parameters**: `share_to_feed`, `caption` sent
✅ **New Enhancement**: `thumb_offset` support added
✅ **Structured Data**: mediaAssets eliminate guessing
✅ **API Version**: Using v23.0 (current, configurable)
✅ **Processing Timeouts**: Adequate for video processing

---

## Testing Recommendations

1. **Single Image**: Verify caption, no media_type needed
2. **Single Video**: Verify REELS media_type, share_to_feed, thumb_offset
3. **Carousel**: Verify children order, mixed image/video
4. **Reel**: Verify REELS with share_to_feed control
5. **Story**: Verify STORIES media_type, no caption

---

## References

- [Stack Overflow: Instagram Graph API Publishing](https://stackoverflow.com/questions/78826092/how-to-publish-on-instagram-using-graph-api)
- [Instagram Graph API Developer Guide 2025](https://elfsight.com/blog/instagram-graph-api-complete-developer-guide-for-2025/)
- [Instagram Platform API Gist](https://gist.github.com/PrenSJ2/0213e60e834e66b7e09f7f93999163fc)
- Meta Developer Documentation (developers.facebook.com)
