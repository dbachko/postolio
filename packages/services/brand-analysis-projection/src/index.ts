import type { EventBridgeEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  connectLambdaDatabase,
  type PrismaClient as LambdaPrismaClient,
} from '@postolio/database/lambda';
import { initSentry, captureException } from '@postolio/observability';

const logger = new Logger({ serviceName: 'brand-analysis-projection' });
const metrics = new Metrics({
  namespace: 'BrandAnalysis',
  serviceName: 'brand-analysis-projection',
});

initSentry({
  serviceName: 'brand-analysis-projection',
});

const PROFILES_TABLE = process.env.BRAND_STYLE_PROFILES_TABLE!;

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } });

function profilePk(brandId: string): string {
  return `BRAND#${brandId}`;
}
function profileSk(version: number): string {
  return `VERSION#${version.toString().padStart(6, '0')}`;
}

// DB connection cached between cold starts
let prisma: LambdaPrismaClient | null = null;

async function getClient(): Promise<LambdaPrismaClient> {
  prisma ??= await connectLambdaDatabase();
  return prisma;
}

// Create the projection table when a development database has not been migrated.
type ExecClient = { $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown> };

async function ensureProjectionTable(client: ExecClient) {
  await client.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS brand_style_profile_projection (
      brand_id TEXT PRIMARY KEY,
      profile_version INTEGER NOT NULL,
      prompt_set_version TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      has_recent_drift BOOLEAN DEFAULT FALSE,
      last_drift_at TIMESTAMPTZ,
      archetype TEXT,
      primary_tones TEXT[] DEFAULT '{}',
      primary_palette TEXT[] DEFAULT '{}',
      topics_top JSONB,
      summary_projection JSONB,
      checksum TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`
  );
  await client.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_profile_version ON brand_style_profile_projection (profile_version);`
  );
  await client.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_archetype ON brand_style_profile_projection (archetype);`
  );
}

function toStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((x): x is string => typeof x === 'string').slice(0, limit);
}

export function computeDerivedProjection(profile: unknown) {
  const p = profile as Record<string, unknown>;
  const text = (p?.text as Record<string, unknown> | undefined) || undefined;
  const visual = (p?.visual as Record<string, unknown> | undefined) || undefined;
  const tonesRaw = (text?.tone as unknown) || [];
  const paletteRaw = (visual?.palette as unknown) || [];
  const topicsRaw = (p?.topics as unknown) || null;
  const tones = toStringArray(tonesRaw, 5);
  const palette = toStringArray(paletteRaw, 8);
  const topicsTop = Array.isArray(topicsRaw) ? (topicsRaw as unknown[]).slice(0, 10) : null;
  const archetype: string | null =
    typeof p?.archetype === 'string' ? (p.archetype as string) : null;
  return { tones, palette, topicsTop, archetype };
}

export interface CompletedDetail {
  brandId: string;
  profileId: string; // "<brandId>#<version>"
  profileVersion: number;
  createdAt: string;
}

export async function handler(
  event: EventBridgeEvent<'brand.analysis.completed', CompletedDetail>
): Promise<void> {
  logger.info('Projection handler invoked', { detailType: event['detail-type'] });
  metrics.addMetric('Invocations', MetricUnit.Count, 1);

  if (event['detail-type'] !== 'brand.analysis.completed' || event.source !== 'postolio.brand') {
    logger.warn('Ignoring event', { detailType: event['detail-type'], source: event.source });
    return;
  }
  const { brandId, profileVersion, createdAt } = event.detail;

  try {
    // Read profile from Dynamo
    const res = await doc.send(
      new QueryCommand({
        TableName: PROFILES_TABLE,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: { ':pk': profilePk(brandId), ':sk': profileSk(profileVersion) },
        Limit: 1,
      })
    );
    const item = res.Items?.[0];
    if (!item) {
      logger.warn('Profile not found in Dynamo; skipping projection', { brandId, profileVersion });
      return;
    }
    const profile = (item as { profile?: unknown })?.profile ?? item;
    const pmeta = profile as { promptSetVersion?: string | null; driftFindings?: unknown[] };

    const client = await getClient();
    await ensureProjectionTable(client);

    // Upsert with version guard (only write if newer)
    const derived = computeDerivedProjection(profile);
    await client.$executeRawUnsafe(
      `INSERT INTO brand_style_profile_projection (
      brand_id, profile_version, prompt_set_version, created_at, has_recent_drift, last_drift_at,
      archetype, primary_tones, primary_palette, topics_top, summary_projection, checksum, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10::jsonb, $11::jsonb, $12, NOW())
    ON CONFLICT (brand_id)
    DO UPDATE SET
      profile_version = EXCLUDED.profile_version,
      prompt_set_version = EXCLUDED.prompt_set_version,
      created_at = EXCLUDED.created_at,
      has_recent_drift = EXCLUDED.has_recent_drift,
      last_drift_at = EXCLUDED.last_drift_at,
      archetype = EXCLUDED.archetype,
      primary_tones = EXCLUDED.primary_tones,
      primary_palette = EXCLUDED.primary_palette,
      topics_top = EXCLUDED.topics_top,
      summary_projection = EXCLUDED.summary_projection,
      checksum = EXCLUDED.checksum,
      updated_at = NOW()
    WHERE brand_style_profile_projection.profile_version < EXCLUDED.profile_version;`,
      brandId,
      profileVersion,
      pmeta.promptSetVersion || null,
      new Date(createdAt),
      Array.isArray(pmeta?.driftFindings) && pmeta.driftFindings.length > 0,
      null,
      derived.archetype,
      derived.tones,
      derived.palette,
      JSON.stringify(derived.topicsTop),
      JSON.stringify(profile),
      null
    );

    logger.info('Projection upserted', { brandId, profileVersion });
    metrics.addMetric('ProjectionWrites', MetricUnit.Count, 1);
  } catch (err) {
    logger.error('Projection handler failed', { brandId, profileVersion, err });
    captureException(err, {
      brandId,
      profileVersion,
      function: 'brand-analysis-projection',
    });
  }
}
