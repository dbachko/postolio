# Instagram post sync

Imports published Instagram posts into Postolio for the Timeline and Calendar views.

- [API reference](api-instagram-sync.md): requests, responses, cooldowns, and errors
- [Facebook OAuth setup](FACEBOOK_OAUTH_SETUP.md): Meta app configuration
- [Analytics ingestor](ANALYTICS-INGESTOR.md): account and publication metrics

## Flow

1. The user connects an Instagram account or requests a sync.
2. The API checks brand access and the sync cooldown.
3. It fetches recent posts, skips duplicates, and imports media through the assets service.
4. Imported publications appear alongside other content in the Timeline and Calendar.

## Troubleshooting

Check the account connection, sync response, and API logs for `[Instagram Sync]`. See the API reference for limits and error responses.
