# Instagram sync API

The social platform API imports recent posts for a connected account. The Instagram service also has a paginated history import used by connection flows. These paths have different limits and cooldown keys.

## Manual sync

```http
POST /api/social/instagram/sync/:brandId
Content-Type: application/json

{ "socialAccountId": "<connected-account-id>" }
```

Requires authentication and brand access. `socialAccountId` selects an account; when omitted, the route resolves the brand's account for the platform.

The route requests 25 recent posts and applies a five-minute cooldown per brand and platform when Redis is available. A cooldown returns HTTP 429 with `retryAfter` and `cooldownSeconds`.

The response includes `success`, `platform`, `synced`, `skipped`, `failed`, `total`, and a `results` object with counts and errors.

Implementation: `packages/apps/api/src/routes/social-platform/register-sync-route.ts` and `sync-helpers.ts`.

## Instagram history import

`InstagramService.syncPublishedPosts` defaults to at most 100 posts from the last 30 days and skips existing posts. It uses a Redis lock to prevent overlapping history imports and stores sync metadata for 24 hours.

Implementation: `packages/apps/api/src/services/instagram-sync-published.ts` and `instagram-sync-single-post.ts`.

## History sync status

```http
GET /api/brands/:brandId/instagram/sync-status
```

Returns `inProgress`, `lockTtl`, `cooldownRemaining`, and `lastSync`. This reports the Instagram history import's Redis keys; it does not report the generic social sync route's cooldown.

Implementation: `packages/apps/api/src/routes/brands-instagram.ts`.

## Troubleshooting

- 401: check authentication and the selected account's Token Service credentials.
- Account not connected: verify the account belongs to the brand and platform.
- 429: wait for `retryAfter` before retrying.
- Partial import: inspect `results.errors`, API logs, and media import failures.

For account and publication metrics, see [analytics ingestion](ANALYTICS-INGESTOR.md).
