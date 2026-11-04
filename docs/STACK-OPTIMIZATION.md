# Deployment stacks

The CDK app is `packages/infra/cdk/bin/app.ts`.

| Stack            | Resources                                             |
| ---------------- | ----------------------------------------------------- |
| `foundation`     | Shared network, database, Redis, and image registry   |
| `auth`           | Token Service and token encryption                    |
| `scheduling`     | Schedule management, cleanup, and status sync         |
| `publishing`     | Publisher, retry handler, and dead-letter queues      |
| `brand-analysis` | Profile analysis, storage, projection, and scheduling |
| `asset-library`  | Assets API, media storage, CDN, and processing        |
| `analytics`      | Analytics ingestor                                    |
| `api`            | Fastify API on ECS                                    |
| `web`            | Frontend storage and CloudFront                       |

Use `scripts/deploy-stack.sh all` to deploy in the script's dependency order, or select stacks explicitly. Environment-specific endpoints and resource IDs are shared through SSM parameters.

See [deployment scripts](../scripts/README.md), [workflow configuration](../.github/workflows/README.md), and [cross-stack configuration](CROSS-STACK-GUIDE.md).
