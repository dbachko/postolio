# Scripts

Helpers for local development, deployment, and billing setup.

## Local HTTPS: ai.localhost (macOS)

Install mkcert (`brew install mkcert`; also `brew install nss` for Firefox), then run:

```bash
pnpm setup:ai-localhost
```

The helper trusts the local CA, generates certificates under `certs/`, and writes SSL paths to the API and web `.env` files. The API runs at `https://ai.localhost:3000` and web at `https://ai.localhost:5173`. The `.localhost` domain resolves to loopback without editing `/etc/hosts`.

If the browser rejects the certificate, run `mkcert -install` and restart it. To regenerate certificates, delete the generated files under `certs/` and rerun the helper.

See the [root README](../README.md) for starting the development stack and resetting local data.

## Dev environment in OrbStack or Docker (macOS)

`devenv.sh` runs the full development stack in an isolated Ubuntu environment, so Node, the databases, and the dev servers stay off your Mac. Pick a backend; every command works the same on both:

| Backend  | What runs the stack                                                                                | Needs                                               |
| -------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `orb`    | An [OrbStack](https://orbstack.dev) Linux machine named `postolio`                                 | OrbStack                                            |
| `docker` | A privileged container named `postolio-devenv`, with its own Docker daemon for Postgres and Valkey | Any Docker engine: Docker Desktop, OrbStack, Colima |

```bash
scripts/devenv.sh up                    # orb if OrbStack is installed, otherwise docker
scripts/devenv.sh --backend docker up   # or choose explicitly (also: POSTOLIO_DEV_BACKEND=docker)
```

After `up`, the other commands find the environment on their own. If both backends have one, they use the running one; pass `--backend` when both are running.

```bash
scripts/devenv.sh up         # create + provision, sync, install, start stack + MCP, wait until healthy
scripts/devenv.sh watch      # hot reload: copy each saved file into the environment (leave running)
scripts/devenv.sh seed       # add a test account (default test@postolio.test / Test123!@#)
scripts/devenv.sh status     # environment, services, MCP, and port forwarding
scripts/devenv.sh mcp config # how to register the browser MCP server with Claude Code
scripts/devenv.sh logs       # follow the stack log
scripts/devenv.sh stop       # stop dev processes, MCP and databases (data kept)
scripts/devenv.sh restart    # stop, sync, reinstall if needed, start
scripts/devenv.sh shell      # shell in the repo copy inside the environment
scripts/devenv.sh destroy    # delete the environment (asks first)
```

The same commands are available as `pnpm devenv <command>` and `pnpm devenv:up`, `devenv:watch`, `devenv:sync`, `devenv:seed`, `devenv:status`, `devenv:logs`, `devenv:stop`.

The first `up` installs Docker, the Node major from `.nvmrc`, the pnpm version from `packageManager`, Chromium, and Playwright MCP, then resets and seeds the databases. `up` reinstalls Node or pnpm when the repo changes them. Later starts keep the data, and databases are reseeded automatically when `docker-compose.yml` switches to new volumes; pass `--reset` to `up`, `start`, or `restart` to reseed anyway. Sign in as `dev@postolio.test` / `Test123!@#`, or create another account with `seed --email you@example.test --password ...`.

### Hot reload

The environment runs a copy of the repo at `~/postolio` on its own disk. Shared mounts from the Mac (OrbStack's `/Users` mount, Docker bind mounts) can miss file-change events or serve stale contents right after a save, so dev servers don't watch your checkout directly. `watch` (or `up --watch`) listens for changes on the Mac and streams each saved file into the environment, where Vite HMR and `tsx watch` reload as usual. It needs Node on the Mac.

`sync` and `watch` copy tracked and untracked files and skip ignored ones (`node_modules`, `dist`, `.env`), so the environment keeps its own Linux installs and `.env`. On first run the `.env` is copied from your root `.env`, or created from `.env.example` with a random `JWT_SECRET`. To change it, edit it with `scripts/devenv.sh shell`. After changing dependencies, run `restart` so `pnpm install` runs in the environment.

### Ports and AI agents

Both backends make web 5173, API 3000, assets API 3002, and Playwright MCP 8931 available on your Mac's `localhost`. The `orb` backend also forwards Postgres 5432/5433 and Valkey 6379; on `docker` the databases stay inside the container (use `scripts/devenv.sh shell` to reach them). `scripts/devenv.sh ports` shows whether each port reaches the environment. A Mac process already holding a port blocks it: stop that process (on `orb`, `http://postolio.orb.local:<port>` also works).

AI agents can test the running app in two ways:

- Open `http://localhost:5173` in the agent's own browser (for example, the Claude desktop app's browser pane).
- Use the Playwright MCP server, which drives headless Chromium inside the environment. Register it once with `claude mcp add --transport http --scope local postolio-browser http://localhost:8931/mcp` (`scripts/devenv.sh mcp config` prints this and a JSON config for other clients). Screenshots and snapshots are saved to `.playwright-mcp/` in your checkout (gitignored).

Set `POSTOLIO_DEV_NAME` to use a different environment name, and `POSTOLIO_DEV_MCP_PORT` for a different MCP port. Run both backends one at a time: they use the same Mac ports.

## Application URLs

`get-app-urls.sh` reads deployed stack outputs for application URLs, API endpoints, resource IDs, and stack status:

```bash
./scripts/get-app-urls.sh dev
./scripts/get-app-urls.sh staging
./scripts/get-app-urls.sh prod
```

## Local AWS deployment

`deploy-stack.sh` loads the root `.env`, maps its values to CDK context, builds dependencies, and deploys the selected stack. Configure AWS CLI credentials and application settings first; see [`.env.example`](../.env.example).

```bash
./scripts/deploy-stack.sh -e dev all
./scripts/deploy-stack.sh -e staging api
./scripts/deploy-stack.sh -f .env.production -e prod api
```

| Option            | Purpose                                 |
| ----------------- | --------------------------------------- |
| `-e, --env`       | `dev` (default), `staging`, or `prod`   |
| `-f, --env-file`  | Environment file (default: root `.env`) |
| `-t, --image-tag` | Docker image tag                        |
| `-h, --help`      | Usage and environment variables         |

### Stacks

| Stack            | Resources                                     |
| ---------------- | --------------------------------------------- |
| `foundation`     | Shared network, database, Redis, and ECR      |
| `auth`           | Token Service                                 |
| `scheduling`     | Schedule management, cleanup, and status sync |
| `brand-analysis` | Profiles, jobs, analysis, and projection      |
| `asset-library`  | Assets API, storage, CDN, and processing      |
| `publishing`     | Publisher, retries, and dead-letter queues    |
| `analytics`      | Analytics ingestor                            |
| `api`            | Fastify API on ECS                            |
| `web`            | Frontend on S3 and CloudFront                 |
| `all`            | All stacks in dependency order                |

The local script deploys infrastructure using the selected image tag. The [GitHub deployment workflow](../.github/workflows/README.md) also builds and pushes images.

### Configuration

The script maps application environment variables to CDK context:

| Environment variable     | CDK context            |
| ------------------------ | ---------------------- |
| `OPENAI_API_KEY`         | `openaiApiKey`         |
| `GOOGLE_CLIENT_ID`       | `googleClientId`       |
| `GOOGLE_CLIENT_SECRET`   | `googleClientSecret`   |
| `FACEBOOK_APP_ID`        | `facebookAppId`        |
| `FACEBOOK_APP_SECRET`    | `facebookAppSecret`    |
| `INSTAGRAM_APP_ID`       | `instagramAppId`       |
| `INSTAGRAM_APP_SECRET`   | `instagramAppSecret`   |
| `INSTAGRAM_REDIRECT_URI` | `instagramRedirectUri` |
| `LINKEDIN_CLIENT_ID`     | `linkedinClientId`     |
| `LINKEDIN_CLIENT_SECRET` | `linkedinClientSecret` |
| `TIKTOK_CLIENT_KEY`      | `tiktokClientKey`      |
| `TIKTOK_CLIENT_SECRET`   | `tiktokClientSecret`   |
| `NODE_ENV`               | `nodeEnv`              |
| `LOG_LEVEL`              | `logLevel`             |
| `ENABLE_MONITORING`      | `enableMonitoring`     |
| `DOMAIN_NAME`            | `domainName`           |
| `VITE_API_URL`           | `corsOrigin`           |

Brand analysis table overrides: `BRAND_PROFILES_TABLE_NAME`, `BRAND_JOBS_TABLE_NAME`, `BRAND_PROFILES_TABLE_PARAM_PATH`, and `BRAND_JOBS_TABLE_PARAM_PATH`. Without overrides, the API uses `postolio-<env>-brand-analysis-profiles` and `postolio-<env>-brand-analysis-jobs`.

### Troubleshooting

- Missing credentials: configure AWS CLI credentials for the target account and region.
- Missing settings: inspect CDK's reported context errors and the selected environment file.
- `ROLLBACK_COMPLETE`: inspect CloudFormation events before accepting the script's prompt to delete the failed stack.
- Image pull failure: check that the selected tag exists and its platform matches the ECS task. See [API image deployment](../docs/api-docker-deployment-guide.md) and [analytics configuration](../docs/ANALYTICS-INGESTOR.md).

## Stripe setup

`setup-stripe-billing.sh` creates or reuses products, prices, portal configuration, and webhook resources. See [Stripe billing setup](../docs/STRIPE-BILLING-SETUP.md) for arguments and environment variables.
