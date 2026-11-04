# Inbox

The Inbox combines comment threads and direct-message conversations. It reads stored data from PostgreSQL and refreshes platform data where needed.

## Routes and filters

- `/inbox`: account selection, filters, comment threads, and conversations
- `/inbox/saved-replies`: reusable replies
- `/dm-automation`: automation rules and analytics

The items API is `GET /api/brands/:brandId/inbox/items`. Filters include social account IDs, channel (`comments` or `dms`), platform, and view (`to_review` or `all`).

## Implementation

| Location                                                   | Purpose                                 |
| ---------------------------------------------------------- | --------------------------------------- |
| `packages/apps/web/src/pages/inbox/`                       | Page state, item list, and detail panel |
| `packages/apps/web/src/lib/api/brand-client-inbox.ts`      | Inbox API calls                         |
| `packages/apps/web/src/pages/saved-replies/`               | Saved reply UI                          |
| `packages/apps/web/src/lib/api/saved-replies-client.ts`    | Saved reply API calls                   |
| `packages/apps/api/src/routes/brands/inbox-items-route.ts` | Inbox API                               |

Comment actions carry the publication ID so the API can resolve the correct social account. Conversations and messages use the selected brand and conversation IDs.

Saved replies use `/api/brands/:brandId/saved-replies` for listing and creation, and `/:replyId` for updates and deletion.

## Troubleshooting

Check account filters, brand access, stored comments/messages, webhook delivery, and platform credentials. A connected account does not guarantee every comment or messaging operation is supported.
