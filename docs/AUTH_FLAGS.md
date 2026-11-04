# Authentication Feature Flags

This repo separates API runtime flags from Web (Vite) build‑time flags to control which auth options appear and/or function.

## Web (Vite): UI visibility

Set these in `packages/apps/web/.env` (local) or pass as build args/vars in CI:

- `VITE_AUTH_GOOGLE_ENABLED` (default: `true`)
- `VITE_AUTH_FACEBOOK_ENABLED` (default: `true`)
- `VITE_AUTH_MAGIC_LINK_ENABLED` (default: `true`)

Behavior:

- If a flag is set to `false`, the corresponding UI is hidden completely.
- Google and Facebook also require configuration:
  - `VITE_GOOGLE_CLIENT_ID`
  - `VITE_FACEBOOK_APP_ID`
    UI is hidden if disabled or not configured.

Examples (local):

```
VITE_GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
VITE_FACEBOOK_APP_ID="1234567890"
VITE_AUTH_GOOGLE_ENABLED=true
VITE_AUTH_FACEBOOK_ENABLED=false
VITE_AUTH_MAGIC_LINK_ENABLED=true
```

## API (Fastify): Magic Link runtime

Set in API environment (ECS, Docker, etc.):

- `AUTH_MAGIC_LINK_ENABLED` (default: `false`)

Behavior:

- When `AUTH_MAGIC_LINK_ENABLED=true` and SMTP/SES is not configured, the API logs magic links to the server logs (dev/test convenience), keeping the flow usable.
- Magic Link still enforces rate limits and token verification.

## GitHub Actions

The main deploy workflow `.github/workflows/deploy.yml` accepts and forwards these:

- Frontend build step uses repository/environment variables:
  - `VITE_AUTH_GOOGLE_ENABLED`
  - `VITE_AUTH_FACEBOOK_ENABLED`
  - `VITE_AUTH_MAGIC_LINK_ENABLED`

- CDK deploy uses context `authMagicLinkEnabled`, sourced from `AUTH_MAGIC_LINK_ENABLED`:
  - In Actions Variables (env‑scoped), set `AUTH_MAGIC_LINK_ENABLED` to `true` or `false`.

## Notes

- Web flags are compile‑time. Changing them requires rebuilding the frontend.
- API flag is runtime (picked up on container start).
