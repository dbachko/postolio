# @postolio/assets-api

Fastify microservice that powers the Asset Library backend. It exposes REST endpoints at `/assets-api/v1` and uses a separate PostgreSQL database (`postolio_assets_dev` locally) and S3 for object storage.

## Local Development

- Start dependencies (Postgres + Redis):
  - `docker compose up -d`
- Migrate databases:
  - Main API DB: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postolio pnpm --filter @postolio/database db:migrate`
  - Assets DB: `ASSETS_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postolio_assets_dev pnpm --filter @postolio/database-assets db:migrate`
- Start services:
  - Assets API: `ASSETS_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postolio_assets_dev JWT_SECRET=<same-as-API> pnpm --filter @postolio/assets-api dev:server`
  - Main API: `pnpm --filter api dev`
  - Web: `pnpm --filter @postolio/web dev`

Vite dev server proxies `/assets-api/*` to the assets service on port 3002. Login at the web UI; both API and assets share the `auth_token` cookie name.

## Seeding Demo Assets

Use the assets database seed script to generate image records (optionally with a CDN base such as `https://picsum.photos`):

```
ASSETS_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postolio_assets_dev \
pnpm --filter @postolio/database-assets db:seed -- \
  --brandId <brandId> --count 12 --cdnBase https://picsum.photos
```

Where `brandId` can be obtained after logging in and creating/selecting a brand in the app. The seed writes `Asset` records plus taxonomy collections/labels (Collections: `General`, `Brand Assets`; Labels: `seed`, `demo`, `video`). Images are referenced by CDN URL when `--cdnBase` is supplied.

## Notes

- Prisma client for assets is generated to `packages/libs/database-assets/assets-client/` and is git‑ignored by default.
- Auth: The assets API accepts either the `auth_token` cookie (preferred in browser) or a `Bearer` token in `Authorization` header.
- For development, set `ASSETS_CDN_DOMAIN=https://picsum.photos` to see thumbnails without uploading to S3.
