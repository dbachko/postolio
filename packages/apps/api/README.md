# API

Fastify backend for brands, content, authentication, and analytics.

## Development

From the repository root:

```bash
pnpm dev:api
```

This builds the API's workspace dependencies and starts the watcher. After changing a library, rebuild it if the watcher reports a missing or stale `dist` file:

```bash
pnpm --filter api run build:deps
```

Other commands:

```bash
pnpm --filter api build
pnpm --filter api lint
pnpm --filter api test
```

See the [root README](../../../README.md) for environment variables and the full development stack.

## Seed local data

Start PostgreSQL and Redis, and point `DATABASE_URL` at your local database:

```bash
docker compose up -d postgres redis
pnpm --filter api seed:dev
```

The seeder creates a user, brand, Instagram and Facebook account records, a publishing queue, and demo content. The account IDs are synthetic and cannot authenticate with those platforms.

Options: `--email`, `--password`, `--name`, `--brand`, and `--posts` (default 10). Defaults are a random `demo+…@example.com` address, password `Test123!@#`, name `Demo User`, and brand `Demo Brand`.

```bash
pnpm --filter api seed:dev -- --email=demo+local@example.com --name="Local Demo" --brand="Local Demo Brand" --posts=8
```

An existing user with the supplied email and their cascading data are deleted before seeding. Log in with the credentials printed by the script. See [scripts/README.md](scripts/README.md) for seed data details and brand analysis fixtures.
