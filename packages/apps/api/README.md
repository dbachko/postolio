# Application: @postolio/api

This is the main backend API for the Postolio application. It is built with Fastify and is responsible for handling all core business logic, data persistence, and communication with backend services.

## Development

### Scripts

- **Dev:** `pnpm dev` (Starts the Fastify server in watch mode)
- **Build:** `pnpm build`
- **Lint:** `pnpm lint`
- **Start:** `pnpm start` (Starts the production server)

To run any script for only this application from the monorepo root, use the `--filter` flag:

```bash
# Example: Start the API in development mode
pnpm --filter=@postolio/api dev
```

### First run after a clean checkout (build deps)

If you’ve just cleaned caches or removed `dist/` outputs, build the API’s workspace dependencies once so the watcher can resolve them:

```bash
# Build all libraries the API depends on (one-time per clean)
pnpm --filter api run build:deps

# Then start the API in watch mode
pnpm --filter api dev
```

If you encounter an error like `Cannot find module '@postolio/aws/dist/index.cjs'`, it means a workspace library hasn’t been built yet—run the `build:deps` step above and retry.

## Seeding Local Data

Use the development seeder to create a user, a brand, social account connection data, and demo posts for local testing.

- Prerequisites:
  - Postgres and Redis running locally. Start with: `docker compose up -d postgres redis`
  - `.env` configured (see `.env.example`). Ensure `DATABASE_URL` or DB vars point at your local Postgres.

- Run the seeder (defaults shown):
  - `pnpm --filter @postolio/api seed:dev`
  - Options:
    - `--email` (default: `demo+<random>@example.com`)
    - `--password` (default: `Test123!@#`)
    - `--name` (default: `Demo User`)
    - `--brand` (default: `Demo Brand`)
    - `--posts` number of posts to create (default: `10`, first few are scheduled)

- Example:
  - `pnpm --filter @postolio/api seed:dev -- --email=demo+local@example.com --password=Test123!@# --name="Local Demo" --brand="Local Demo Brand" --posts=8`

- What it creates:
  - One user (existing user with the same email is deleted and re-created for idempotency)
  - One brand linked to that user
  - One Instagram social account for the brand
  - A default publishing queue with a few weekly slots
  - Content posts covering the main statuses (`draft`, `scheduled`, `published`) with past and future dates

- After seeding:
  - Start API: `pnpm --filter @postolio/api dev`
  - Start Web: `pnpm --filter @postolio/web dev`
  - Log in using the printed credentials from the seed output
