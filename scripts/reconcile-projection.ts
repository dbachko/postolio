#!/usr/bin/env -S node --no-warnings
/*
  Compares Dynamo latest BrandStyleProfiles version with Postgres projection version.
  Prints mismatches and optionally emits a re-sync event.

  Env:
    - BRAND_STYLE_PROFILES_TABLE (Dynamo)
    - EVENT_BUS_NAME (optional; to emit events)
    - AWS_REGION (for SDK)
    - DATABASE_URL (for Prisma)

  Usage:
    pnpm tsx scripts/reconcile-projection.ts [--emit]
*/
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { PrismaClient } from '@postolio/database';

const PROFILES_TABLE = process.env.BRAND_STYLE_PROFILES_TABLE;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const emit = process.argv.includes('--emit');

if (!PROFILES_TABLE) {
  console.error('Missing BRAND_STYLE_PROFILES_TABLE');
  process.exit(2);
}

function profilePk(brandId: string): string {
  return `BRAND#${brandId}`;
}

async function getLatestDynamoVersion(
  doc: DynamoDBDocumentClient,
  brandId: string
): Promise<number | null> {
  const res = await doc.send(
    new QueryCommand({
      TableName: PROFILES_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': profilePk(brandId) },
      ScanIndexForward: false,
      Limit: 1,
    })
  );
  const item = res.Items?.[0] as { version?: number } | undefined;
  return item?.version ?? null;
}

async function main() {
  const prisma = new PrismaClient();
  const ddb = new DynamoDBClient({});
  const doc = DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const eb = new EventBridge({});

  const projections = await prisma.brandStyleProfileProjection.findMany({
    select: { brandId: true, profileVersion: true },
  });
  let driftCount = 0;
  for (const row of projections) {
    const latest = await getLatestDynamoVersion(doc, row.brandId);
    if (latest && latest > row.profileVersion) {
      driftCount++;
      console.log(`[DRIFT] brand=${row.brandId} projection=${row.profileVersion} latest=${latest}`);
      if (emit && EVENT_BUS_NAME) {
        await eb.send(
          new PutEventsCommand({
            Entries: [
              {
                DetailType: 'brand.analysis.resync-requested',
                Source: 'postolio.brand',
                EventBusName: EVENT_BUS_NAME,
                Detail: JSON.stringify({ brandId: row.brandId, expectedVersion: latest }),
              },
            ],
          })
        );
      }
    }
  }
  console.log(`ProjectionDriftCount=${driftCount}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
