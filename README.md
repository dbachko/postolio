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
