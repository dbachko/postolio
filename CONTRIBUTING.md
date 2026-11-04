# Contributing

Use Node.js 22 or newer and the PNPM version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm prettier --check '**/*.{ts,tsx,md}' --ignore-path .gitignore
```

Use `pnpm exec turbo build --filter=api` or `--filter=@postolio/web` for an application and its
workspace dependencies. Individual package build scripts assume their dependencies are built.
Database generation runs without Turbo caching to avoid missing or stale generated clients.

`pnpm dev:stack` preserves existing data and only accepts local database targets. Resetting local
data requires both `CONFIRM_LOCAL_DB_RESET=delete-local-data` and `pnpm dev:reset`. Never point
local development tools at production databases.

The asset integration suite requires an empty disposable PostgreSQL database on loopback whose
name ends in `_test` or `_review`. Set `ASSETS_DATABASE_URL` and `ASSETS_S3_BUCKET=test-bucket`,
apply migrations with `pnpm --filter @postolio/database-assets exec prisma migrate deploy`, then
run `pnpm --filter @postolio/assets-api test:integration`. The suite uses real database constraints
and substitutes the S3 transport; it does not contact AWS.

Browser checks use a built local web application and stubbed API/provider traffic:

```sh
pnpm --filter @postolio/web exec playwright install chromium firefox webkit
pnpm --filter @postolio/web exec playwright test
pnpm --filter @postolio/web exec playwright test --config playwright.screenshots.config.ts
```

Build the web application before running these checks. Do not rebuild it while a preview test is
running. Screenshots go to test artifacts, not tracked documentation files. These tests do not
prove live provider integrations or deployed infrastructure behavior.

Use a feature branch and a focused Conventional Commit. Include the behavior change, test results,
and any migration or configuration steps in the pull request. Read [SECURITY.md](SECURITY.md)
before handling credentials or reporting vulnerabilities.

Unless explicitly stated otherwise, contributions are submitted under Apache-2.0. Existing
third-party components and dependencies retain their own licenses and notices.
