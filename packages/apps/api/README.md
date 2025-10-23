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

## Seeding Local Data

Use the development seeder to create a user, a brand, demo posts, and a sample campaign for local testing.

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
  - One user (re-used on subsequent runs if email exists)
  - One brand linked to that user
  - N pieces of content (mix of `draft` and `scheduled`)
  - One active campaign with simple daily config

- After seeding:
  - Start API: `pnpm --filter @postolio/api dev`
  - Start Web: `pnpm --filter @postolio/web dev`
  - Log in using the printed credentials from the seed output
