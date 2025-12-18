# Social Accounts Service (WIP)

Greenfield microservice scaffold for Postolio’s multi-platform, multi-account connection model.

See:

- `docs/social-accounts-service-architecture.md`
- `docs/social-accounts-multi-platform-research.md`
- `docs/implementation-plan-social-accounts-multi-platform.md`

## Endpoints (planned)

- `GET /health`
- `GET /brands/:brandId/social-accounts`
- `POST /brands/:brandId/social-accounts/connect/meta/start`
- `GET /brands/:brandId/social-accounts/connect/meta/callback`
- `GET /brands/:brandId/social-accounts/connect/meta/candidates`
- `POST /brands/:brandId/social-accounts/connect/meta/finalize`

## Status

This package currently includes only a minimal Lambda handler skeleton and is not yet wired into CDK/deploy stacks.
