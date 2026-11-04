# Session management

The API stores access and refresh tokens in HttpOnly cookies. The web app sends cookies with requests and refreshes access tokens through `AuthInterceptor`.

## Implementation

| File                                                | Purpose                                         |
| --------------------------------------------------- | ----------------------------------------------- |
| `packages/apps/api/src/routes/auth.ts`              | Authentication endpoints                        |
| `packages/apps/api/src/services/refresh-token.ts`   | Token rotation and reuse detection              |
| `packages/apps/api/src/services/session.service.ts` | Session storage and timeouts                    |
| `packages/apps/web/src/lib/auth-interceptor.ts`     | Refresh scheduling and coordination across tabs |
| `packages/apps/web/src/lib/http/http.ts`            | Credentialed requests and 401 handling          |
| `packages/apps/web/src/stores/authStore.ts`         | Frontend auth state                             |

The interceptor refreshes every 12 minutes and when the page becomes visible. It coordinates concurrent requests and tabs to avoid rotating the same token twice. Local storage holds refresh coordination data, not auth tokens.

Refresh tokens expire after 30 days. Session limits are 30 days of inactivity and 90 days from creation. The [session cleanup Lambda](../packages/services/session-cleanup/README.md) revokes expired sessions and removes old records.

## Verification

Follow the [verification guide](guides/QUICK-START-session-management.md).

## Troubleshooting

- Unexpected logout: inspect refresh requests and errors; check that the interceptor starts and requests include credentials.
- Missing cookies: check the request host, cookie settings, HTTPS, and CORS credentials.
- Token reuse errors: inspect concurrent refreshes and coordination across tabs before changing rotation settings.
