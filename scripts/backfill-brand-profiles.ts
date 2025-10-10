/**
 * Backfill script: Emit brand.analysis.requested for brands without profiles
 * Plan-only skeleton. Integrate Prisma + EventBridge in a later iteration.
 */

async function main() {
  console.log('Backfill Brand Profiles - plan skeleton');
  // TODO: query brands from Postgres and emit events per brand
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
