# Projection reconciliation

`scripts/reconcile-projection.ts` compares profile versions in the PostgreSQL projection with the latest DynamoDB Brand Style Profile. It prints detected drift and can emit `brand.analysis.resync-requested` events.

## Run

From the repository root:

```bash
pnpm tsx scripts/reconcile-projection.ts
pnpm tsx scripts/reconcile-projection.ts --emit
```

Set `BRAND_STYLE_PROFILES_TABLE`, `AWS_REGION`, and `DATABASE_URL`. Emitting events also requires `EVENT_BUS_NAME` and permission to publish to it.

The default run only reports drift. Check the emitted events and projection updates when using `--emit`.
