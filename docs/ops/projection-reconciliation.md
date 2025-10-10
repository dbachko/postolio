# Projection Reconciliation — Operations Guide

## Goal

Detect and reconcile drift between the authoritative DynamoDB BrandStyleProfiles (latest version) and the Postgres projection table (brand_style_profile_projection).

## Algorithm

1. Query all rows from projection table: `{ brand_id, profile_version }`
2. For each brand, query Dynamo for `PK=BRAND#<id>` with `ScanIndexForward=false`, `Limit=1` → `latest.version`
3. If `latest.version > projection.profile_version`, mark as drift
4. Optionally emit `brand.analysis.resync-requested` event with `{ brandId, expectedVersion }`

## Metrics

- `ProjectionDriftCount` (gauge or count per run)
- Optional: `ProjectionResyncRequested` (count of events emitted)

## Running

```
pnpm tsx scripts/reconcile-projection.ts            # dry run, prints drift lines
pnpm tsx scripts/reconcile-projection.ts --emit     # emits EventBridge events
```

Required env:

- `BRAND_STYLE_PROFILES_TABLE`, `EVENT_BUS_NAME` (for --emit), `AWS_REGION`, `DATABASE_URL`

## Notes

- This is an offline one-shot job; for continuous monitoring, schedule as a cron and publish metrics to CloudWatch.
- For large brands volume, batch Dynamo queries and/or add delay to respect read capacity.
