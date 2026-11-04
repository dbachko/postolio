# Social accounts service

Lambda handler scaffold. `GET /health` responds; the social account routes return HTTP 501. This package is not wired into the deployment stacks.

## Stub routes

- `GET /brands/:brandId/social-accounts`
- `POST /brands/:brandId/social-accounts/connect/meta/start`
- `GET /brands/:brandId/social-accounts/connect/meta/callback`
- `GET /brands/:brandId/social-accounts/connect/meta/candidates`
- `POST /brands/:brandId/social-accounts/connect/meta/finalize`
