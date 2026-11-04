# JWT and refresh tokens

The API uses short-lived access tokens and rotating refresh tokens. Browser clients use HttpOnly cookies; the web interceptor coordinates refreshes within a tab and across tabs.

Refresh tokens expire after 30 days. Redis tracks token families for reuse detection, with a 15-second rotation grace period for concurrent requests. See `packages/apps/api/src/services/refresh-token.ts` for limits and rotation behavior.

## Configuration

Generate a JWT secret and set `JWT_SECRET` in your environment:

```bash
pnpm --filter api generate-secret
```

Use the same secret for the API and assets API. Keep secrets out of version control. Redis is required for token storage and auth rate limiting.

## Troubleshooting

- Rate limited: wait for the interval in `Retry-After`.
- Invalid or expired refresh token: sign in again; inspect rotation and reuse logs if it recurs.
- Unexpected logout across tabs: inspect refresh locking and timing before changing token limits.

See [session management](SESSION-MANAGEMENT-README.md) and its [verification guide](guides/QUICK-START-session-management.md).
