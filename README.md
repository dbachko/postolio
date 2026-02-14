# Postolio: Monorepo Architecture

Welcome to the Postolio monorepo. This project has been refactored from a monolithic structure into a modern, scalable monorepo using **pnpm workspaces** and **Turborepo**. This document provides an extensive overview of the new architecture, its core principles, and the development workflows required to contribute effectively.

---

## 1. Architectural Principles

The new architecture is built on a set of core principles designed to enhance developer experience, improve performance, and ensure scalability.

### a. Code Colocation & Centralized Management

All applications, services, and libraries are located within a single repository. This provides a single source of truth, simplifies dependency management, and allows for atomic commits across multiple parts of the system.

### b. Explicit Package Boundaries

The codebase is divided into discrete packages, each with its own `package.json` file defining its dependencies and scripts. This enforces clear ownership and separation of concerns, preventing implicit dependencies and code "spaghetti."

### c. Efficient Development with Turborepo

We leverage **Turborepo** for high-performance build caching and task orchestration. Turborepo understands the dependency graph of the monorepo, enabling it to:

- **Cache Build Outputs:** Never rebuild code that hasn't changed.
- **Parallel Execution:** Run tasks like `build`, `lint`, and `test` across multiple packages in parallel.
- **Pruned Scopes:** Run tasks only on the packages affected by your changes.

### d. Centralized Tooling & Configuration

Tooling such as ESLint, TypeScript, and Prettier is configured at the root level and extended by individual packages. This ensures consistent code style and quality across the entire codebase without duplicating configuration.

### e. Selective & Independent Deployment

Each application and service is independently deployable. Our CI/CD pipeline, powered by GitHub Actions, is configured to only build and deploy packages that have changed, dramatically reducing deployment times and risk.

---

## 2. Monorepo Structure

The monorepo is organized into logical directories under the `packages/` folder.

- **`packages/apps`**: Contains user-facing applications.
  - `api`: The main backend API (Fastify).
  - `web`: The frontend React application (Vite).

- **`packages/services`**: Houses backend microservices and serverless functions.
  - `token-service`: Manages authentication and API tokens.
  - `dlq-processor`: Processes messages from the Dead-Letter Queue.
  - _(Other services like `publisher`, `schedule-management`, etc.)_

- **`packages/libs`**: A collection of shared libraries used across different apps and services.
  - `database`: Prisma client, schema, and database utilities.
  - `ui`: Shared React components for the frontend.
  - `eslint-config-custom`: Centralized ESLint configuration.
  - `tsconfig`: Shared TypeScript `tsconfig.json` presets.

- **`packages/infra`**: Contains all infrastructure-as-code definitions.
  - `cdk`: The AWS CDK application for deploying all services and infrastructure.

---

## 3. Development Workflow

### a. Prerequisites

- **Node.js v22+** (as defined in `.nvmrc`)
- **pnpm v9+**

### b. Installation

Clone the repository and run the following command from the root directory. This will install all dependencies for all packages and link them together.

```bash
pnpm install
```

### c. Running in Development

To start all applications and services in development mode, run:

```bash
# Starts the api, web, and other services concurrently
pnpm dev
```

To run a specific application (e.g., only the frontend):

````bash
# The "..." syntax tells Turborepo to also run the dev script for all dependencies of "web"
pnpm dev --filter=@postolio/web...

#### Stripe billing setup

If you are working on pricing, checkout, invoices, or credit top-ups, complete Stripe setup first:

- `docs/STRIPE-BILLING-SETUP.md`

It documents account registration, where to find each Stripe key/price ID, required env variables, and webhook setup.

#### API dev quick start (after a clean checkout or cache purge)

If you recently cleared build artifacts (e.g., deleted `dist/` folders or ran a clean), build the API’s workspace dependencies once so their `dist` outputs exist for the watcher:

```bash
# Build all libraries the API depends on (one-time per clean)
pnpm --filter api run build:deps

# Then start the API in watch mode
pnpm --filter api dev
````

If you see errors like “Cannot find module '@postolio/aws/dist/index.cjs'”, it means a workspace library hasn’t been built yet—run the `build:deps` step above and retry.

#### Web dev quick start (after a clean checkout or cache purge)

The web app imports workspace libraries (for example `@postolio/csrf-client`) that export built files from their `dist/` folders. After cleaning caches or in a fresh clone, build those dependencies once, then start Vite:

```bash
# Build only web’s workspace dependencies (not the web bundle)
pnpm --filter @postolio/web^... run build

# Then start the web app
pnpm --filter @postolio/web dev
```

Tip: If Vite reports it cannot resolve a `@postolio/*` package’s `dist/*` file, it means that library hasn’t been built yet—run the dependency build command above and retry.

#### Shared Docker Compose project name

When you keep multiple clones of the repo checked out, Docker Compose uses the directory name as the project/container prefix and you end up with duplicated `postgres` / `redis` containers. Export a shared project name once in your shell profile (e.g. `~/.zshrc` or `~/.bash_profile`) so every terminal session reuses the same containers:

```bash
echo 'export COMPOSE_PROJECT_NAME=postolio' >> ~/.zshrc
# reload your shell after editing the profile
```

For Fish shell, append the equivalent to `~/.config/fish/config.fish`:

```fish
set -x COMPOSE_PROJECT_NAME postolio
```

You can override the name for one-off tasks with `COMPOSE_PROJECT_NAME=custom-name <command>`. The helper script `scripts/restart-dev-stack.sh` respects this variable and will stop/start the shared Postgres + Redis pair.

#### One-command dev stack (API + Assets API + Web)

Use the bundler script to restart Docker infrastructure and launch all dev servers (Fastify API, assets API, and the web dashboard) in one shot:

```bash
pnpm run dev:stack
```

What it does:

- Stops any lingering pnpm/tsx/vite processes and frees the local dev ports.
- Sets `COMPOSE_PROJECT_NAME` (default `postolio`) so all clones share the same containers.
- Runs `scripts/restart-dev-stack.sh` to down/up the Docker services.
- Spins up both Postgres containers (`postgres` on 5432 for the main API, `postgres_assets` on 5433 for the assets service) plus Redis via Docker Compose.
- Loads environment variables from `.env`, drops the local Postgres database, reapplies Prisma migrations, and seeds a deterministic dev user (`dev@postolio.test` / `Test123!@#`). Skip this by exporting `SKIP_DB_RESET=1`. Customize the seed via `DEV_SEED_EMAIL`, `DEV_SEED_PASSWORD`, `DEV_SEED_NAME`, `DEV_SEED_BRAND`, or `DEV_SEED_POSTS`. The assets database is also reset on every run (set `SKIP_ASSETS_DB_RESET=1` to keep its data), migrations are reapplied, and assets seeding runs unless you export `SKIP_ASSETS_SEED=1`.
- Post/media thumbnails use placeholder CDN URLs by default: `POST_SEED_IMAGE_BASE=https://picsum.photos` for generated posts and `ASSETS_SEED_CDN_BASE=https://picsum.photos` for the Assets service. Override either env var if you want to point at an S3 bucket or custom CDN. At runtime, dev also skips OpenAI/Midjourney image generation when `SKIP_IMAGE_GENERATION=1` (default) and returns `PLACEHOLDER_IMAGE_BASE` URLs instead of hitting external providers.
- Automatically looks up the seeded brand ID (based on `ASSETS_SEED_BRAND_EMAIL` / `ASSETS_SEED_BRAND_NAME`, defaulting to the main seed user) and runs the assets seeder with that ID. Tweak the payload via `ASSETS_SEED_COUNT` and `ASSETS_SEED_CDN_BASE`.
- Builds the API and web workspace dependencies (skip with `SKIP_DEP_BUILDS=1 pnpm run dev:stack`).
- Starts the API (`pnpm --filter api dev`), assets API (`pnpm --filter @postolio/assets-api dev`), and web (`pnpm --filter @postolio/web dev`) watchers concurrently. Press `Ctrl+C` to stop everything.
- Forces the assets API to use `ASSETS_API_PORT` (default `3002`) so it never collides with the main API port (`3000`). Override by exporting `ASSETS_API_PORT=<port>` before running the stack.

The assets service connects via `ASSETS_DATABASE_URL` (default `postgresql://postgres:postgres@localhost:5433/postolio_assets_dev`). Docker Compose exposes that secondary Postgres on host port `5433`, so make sure your `.env` carries the matching URL if you previously pointed it elsewhere.

> DB reset wipes your local data on every run. Export `SKIP_DB_RESET=1` before running the stack if you need to keep state for debugging. To wipe the assets database as well, export `RESET_ASSETS_DB=1` (ensure `ASSETS_DATABASE_URL` points at a running instance).

#### Freeing stuck dev ports

If you bounce between multiple clones or crash a watcher, Node/Vite can leave the usual ports (`3000`, `3002`, `5173`) occupied and you’ll see `EADDRINUSE`. Run the cleanup helper to stop lingering processes (it also respects `api.dev.pid` / `web.dev.pid` files):

```bash
bash scripts/kill-dev-processes.sh
```

To target additional ports, pass them via `DEV_PORTS="4173 6006" bash scripts/kill-dev-processes.sh`.

````

### d. Building for Production

To build all apps and services, run the following command from the root. Turborepo will cache artifacts and only build what has changed since the last build.

```bash
pnpm build
````

To build only a specific app and its dependencies:

```bash
pnpm build --filter=@postolio/api...
```

### e. Linting and Testing

Run linting and tests across the entire monorepo:

```bash
pnpm lint
pnpm test
```

---

## 4. CI/CD: Selective Deployment

Our deployment pipeline is configured using separate, focused GitHub Actions workflows for each deployable unit (e.g., `deploy-api.yml`, `deploy-web.yml`).

- **Trigger:** Workflows are triggered on pushes to the `main` branch.
- **Path Filtering:** Each workflow uses a `paths` filter to ensure it only runs if code within its specific package (or a shared dependency like a `libs` package) has changed.

For example, a change to `packages/apps/api/src/index.ts` will only trigger the `deploy-api.yml` workflow, while the `deploy-web.yml` workflow will be skipped. This ensures fast, efficient, and isolated deployments.

---

## 5. Key Scripts

The following scripts in the root `package.json` are the most common entry points for development:

| Command        | Description                                             |
| -------------- | ------------------------------------------------------- |
| `pnpm install` | Installs all dependencies for the entire monorepo.      |
| `pnpm dev`     | Runs all applications and services in development mode. |
| `pnpm build`   | Builds all applications, services, and libraries.       |
| `pnpm lint`    | Lints the entire codebase.                              |
| `pnpm test`    | Runs all tests across the monorepo.                     |

---

## 6. Brand Analysis Overview (Profiles, Learning, Generation)

Postolio includes a dedicated Brand Analysis microservice that produces a versioned Brand Style Profile used by the API/content generator and the Web UI.

- Event-driven flow:
  - `brand.analysis.requested` → microservice runs multi-stage analysis → writes profile to DynamoDB → emits `brand.analysis.completed`.
  - A projection Lambda upserts the latest profile into Postgres table `brand_style_profile_projection` for fast reads by API/WEB.
  - The API’s learning service emits `brand.learning.applied` on user edits; the microservice stores learning signals and biases synthesis on re-analysis.

- Generation uses the projection row to build brand-aware prompts (tones, topics, palette, motifs, composition) for both text and images.

### Tunable Environment Variables

The learning-informed synthesis supports simple tuning via environment variables:

- `BRAND_ANALYSIS_STOPWORDS` (comma-separated): extend tokenization stopwords used for learning hints.
- `BRAND_ANALYSIS_DECAY_DAYS` (default 30): recency decay constant in days for learning signals.
- `BRAND_ANALYSIS_TOPIC_HINT_SCALE` (default 5): converts topic hint weight into count increments.

These can be set in `.env` for dev, and configured per-environment in production (e.g., Lambda env or ECS task env).

### UI

- Brands page shows tones + top 3 palette swatches and includes a “View Profile” drawer.
- Drawer provides a “Re-run Analysis” button to manually request a refresh.

## Assets Microservice (dev quick start)

Backend service lives at `packages/apps/assets-api` and exposes `/assets-api/v1/*`.

- Run Postgres + Redis:
  - `docker compose up -d`
- Migrate DBs:
  - Main DB: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postolio pnpm --filter @postolio/database db:migrate`
  - Assets DB: `ASSETS_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postolio_assets_dev pnpm --filter @postolio/database-assets db:migrate`
- Start services:
  - Assets API: `ASSETS_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postolio_assets_dev JWT_SECRET=<match API> pnpm --filter @postolio/assets-api dev:server`
  - Main API: `pnpm --filter api dev`
  - Web: `pnpm --filter @postolio/web dev`

Seed demo assets (optional):

```
ASSETS_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postolio_assets_dev \
  pnpm --filter @postolio/database-assets db:seed -- \
  --brandId <yourBrandId> --count 12 --cdnBase https://picsum.photos
```

Notes:

- UI for the Asset Library now lives in the web app at `src/features/assets` (no Module Federation).
- The assets Prisma client is generated to `packages/libs/database-assets/assets-client` and is ignored by git.
