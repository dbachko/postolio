# Postolio

Postolio manages social media brands, content, scheduling, and analytics. This repository uses pnpm workspaces and Turborepo.

## Repository layout

| Directory            | Contents                                                    |
| -------------------- | ----------------------------------------------------------- |
| `packages/apps`      | Fastify API, assets API, and React web app                  |
| `packages/services`  | Publishing, scheduling, token management, and other workers |
| `packages/libs`      | Shared libraries, database schemas, and tooling             |
| `packages/infra/cdk` | AWS infrastructure                                          |

See [STRUCTURE.md](STRUCTURE.md) for file placement and import rules.

## Local setup

Use Node.js 26 (Lambdas run on 24) and the pnpm version pinned in `package.json`.
Configure `.env` using [.env.example](.env.example), with local database URLs:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postolio
ASSETS_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postolio_assets_dev
```

Install dependencies and start the development stack:

```bash
pnpm install --frozen-lockfile
pnpm dev:stack
```

The stack starts PostgreSQL on ports 5432 and 5433, Valkey (Redis-compatible), the API on 3000, the assets API on 3002, and the web app on 5173. It applies pending migrations, builds workspace dependencies, and starts the watchers. Press `Ctrl+C` to stop them.

`dev:stack` stops lingering development processes and frees the development ports before starting. It uses the Docker Compose project name `postolio` by default, so clones share the same containers. Set `COMPOSE_PROJECT_NAME` to use a separate stack.

Startup preserves database data. To reset and seed local databases:

```bash
CONFIRM_LOCAL_DB_RESET=delete-local-data pnpm dev:reset
```

Seed options: `DEV_SEED_EMAIL`, `DEV_SEED_PASSWORD`, `DEV_SEED_NAME`, `DEV_SEED_BRAND`, and `DEV_SEED_POSTS`. Set `SKIP_ASSETS_SEED=0` to seed assets, with `ASSETS_SEED_COUNT` controlling the count. The assets seeder uses the brand selected by `ASSETS_SEED_BRAND_EMAIL` and `ASSETS_SEED_BRAND_NAME`, which default to the main seed user and brand.

Generated posts and seeded assets use `https://picsum.photos` by default. Override `POST_SEED_IMAGE_BASE` or `ASSETS_SEED_CDN_BASE` to use another source. Development skips image generation by default (`SKIP_IMAGE_GENERATION=1`) and uses `PLACEHOLDER_IMAGE_BASE` for runtime placeholders.

For local HTTPS and OAuth, see [scripts/README.md](scripts/README.md#local-https-ailocalhost-macos). For billing work, follow [Stripe setup](docs/STRIPE-BILLING-SETUP.md).

To run the stack in an isolated Linux environment instead (an OrbStack machine or a Docker container), use `scripts/devenv.sh up`. See [Dev environment in OrbStack or Docker](scripts/README.md#dev-environment-in-orbstack-or-docker-macos).

### Run apps separately

Start the databases and Valkey:

```bash
pnpm dev:db
```

Build workspace dependencies before starting an app after a clean checkout or deleting `dist` folders:

```bash
# API
pnpm dev:api

# Web (in another terminal)
pnpm dev:web

# Assets API (in another terminal)
pnpm --filter @postolio/assets-api dev
```

If an app cannot resolve a `@postolio/*` package's `dist` file, rebuild its dependencies:

```bash
pnpm --filter api run build:deps
pnpm --filter @postolio/web^... run build
```

Set `JWT_SECRET` to the same value for the API and assets API. The assets service uses `ASSETS_DATABASE_URL`; Docker Compose exposes its database on port 5433. See the [assets API README](packages/apps/assets-api/README.md) for migrations and demo assets.

To stop processes holding development ports:

```bash
bash scripts/kill-dev-processes.sh
```

Pass extra ports with `DEV_PORTS="4173 6006"`. To skip dependency builds when restarting the full stack, use `SKIP_DEP_BUILDS=1 pnpm dev:stack`. Override the assets API port with `ASSETS_API_PORT` (default 3002).

## Build and check

Run from the repository root:

```bash
pnpm build
pnpm lint
pnpm test
pnpm typecheck
```

Build one app and its dependencies:

```bash
pnpm exec turbo build --filter=api
pnpm exec turbo build --filter=@postolio/web
```

Turborepo caches task outputs and runs tasks in dependency order. See [CONTRIBUTING.md](CONTRIBUTING.md) for formatting, database integration tests, and browser checks.

## Deployment

GitHub Actions deployments run manually. Select a ref and environment in `deploy.yml`; use `stacks=changed` to deploy stacks affected by the diff. `deploy-vps.yml` deploys the Docker Compose stack to a VPS.

See the [workflow reference](.github/workflows/README.md), [local deployment scripts](scripts/README.md), and [VPS guide](docs/VPS_DEPLOYMENT.md).

## Feature references

See the [documentation index](docs/README.md) for setup and operations guides.

- [Brand analysis](packages/services/brand-analysis/README.md): profiles, learning signals, and generation settings
- [Analytics ingestor](docs/ANALYTICS-INGESTOR.md): worker configuration and troubleshooting
- [Session management](docs/SESSION-MANAGEMENT-README.md): cookies, refresh, and verification
- [Instagram sync](docs/README-INSTAGRAM-SYNC.md): imports and API reference
- [Media assets](docs/media-assets-flow.md): storage, uploads, and publishing
- [Recipes and generations](docs/RECIPES_GENERATIONS_ARCHITECTURE.md): concepts and data model

## License

Postolio uses [Apache-2.0](LICENSE). Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [PUBLICATION.md](PUBLICATION.md) before contributing or publishing a distribution.
