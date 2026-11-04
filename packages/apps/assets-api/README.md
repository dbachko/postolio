# Assets API

Fastify service for the Asset Library, with endpoints under `/assets-api/v1`, a separate PostgreSQL database, and S3 object storage.

## Local development

Set `ASSETS_DATABASE_URL` and use the same `JWT_SECRET` as the main API. Docker Compose exposes the assets database on port 5433:

```env
ASSETS_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postolio_assets_dev
```

From the repository root:

```bash
docker compose up -d
pnpm --filter @postolio/database-assets db:migrate
pnpm --filter @postolio/assets-api dev
```

Start the main API and web app as described in the [root README](../../../README.md). Vite proxies `/assets-api/*` to port 3002. The assets API accepts the `auth_token` cookie or an `Authorization: Bearer <token>` header.

## Demo assets

With `ASSETS_DATABASE_URL` set, seed assets for an existing brand:

```bash
pnpm --filter @postolio/database-assets db:seed -- \
  --brandId <brandId> --count 12 --cdnBase https://picsum.photos
```

The seeder creates asset records, collections (`General`, `Brand Assets`), and labels (`seed`, `demo`, `video`). With `--cdnBase`, images use external URLs. Set `ASSETS_CDN_DOMAIN=https://picsum.photos` for local thumbnails without S3 uploads.

The generated Prisma client lives in `packages/libs/database-assets/assets-client/` and is ignored by Git.
