# Verify session management

Start the API and web app using the [local setup instructions](../../README.md#local-setup).

## Browser checks

1. Log in and inspect cookies in browser developer tools.
2. Confirm `auth_token` and `refresh_token` are HttpOnly, with the expected Secure and SameSite settings for the environment.
3. Confirm login and refresh responses do not expose auth tokens in JSON.
4. Confirm local storage contains no auth tokens. Refresh timestamps and locks may be present.
5. Leave the app open for at least 12 minutes and inspect the refresh request. Navigate to another page and confirm authentication still works.
6. Open a second tab and check that refreshes do not cause token reuse errors.
7. Log out and confirm authenticated requests are rejected.

## Automated checks

From the repository root:

```bash
pnpm --filter api test auth-cookies
pnpm --filter api test auth-refresh
pnpm --filter api test refresh-token
```

## Troubleshooting

If cookies are missing, check the host, HTTPS, cookie attributes, and CORS credentials. If requests return 401, confirm the HTTP client includes cookies and inspect the refresh response.

See [session management](../SESSION-MANAGEMENT-README.md) for implementation files and timeout settings.
