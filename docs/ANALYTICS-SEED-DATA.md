# Analytics seed data

The API development seeder creates synthetic Instagram publication metrics. It creates up to three published posts, with the remainder of `--posts` split between scheduled posts and drafts.

```bash
pnpm --filter api seed:dev -- --posts=10
```

Published posts get `ContentPublication` and `PublicationMetricsLatest` records. Metrics include impressions, reach, likes, comments, saves, shares, and video views. The seeder does not create a full historical analytics series, and some aggregates remain zero.

Use the credentials and brand ID printed by the script. See [API scripts](../packages/apps/api/scripts/README.md) for options and the existing-user deletion behavior.

If analytics views are empty, check the selected social account and seeded publication records. Views that need historical samples may require ingestion or additional fixtures.
