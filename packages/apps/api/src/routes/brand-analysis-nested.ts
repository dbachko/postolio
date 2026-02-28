import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { getDatabaseClient } from '../config/database.js';
import { assertBrandOwnership } from '../services/ownership.js';
import { instagramService } from '../services/instagram.js';
import { importImageFromExternalUrl } from '../services/assets-media.js';
import { buildAnalysisAssetMetadata } from '../services/brand-analysis-assets.js';

const eventBridge = new EventBridge({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';
// In local/dev, these may be unset. Handlers below degrade gracefully when absent.
const PROFILES_TABLE = process.env.BRAND_STYLE_PROFILES_TABLE;
const JOBS_TABLE = process.env.BRAND_ANALYSIS_JOBS_TABLE;

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } });
const prisma = getDatabaseClient();

function profilePk(brandId: string): string {
  return `BRAND#${brandId}`;
}
function profileSk(version: number): string {
  return `VERSION#${version.toString().padStart(6, '0')}`;
}

// Nested brand analysis routes under /api/brands
// Maps to:
//  POST   /api/brands/:brandId/analysis
//  GET    /api/brands/:brandId/analysis/status
//  GET    /api/brands/:brandId/analysis/profile
//  GET    /api/brands/:brandId/analysis/profiles
//  GET    /api/brands/:brandId/analysis/diff/:a/:b
async function loadBrandAnalysisContext(brandId: string) {
  const brandInfo = await prisma.brand.findFirst({
    where: { id: brandId },
    select: { countryCode: true, preferences: true },
  });
  const prefsRaw = brandInfo?.preferences as { profileFreezeCore?: boolean } | null;
  const freezeCore =
    prefsRaw && typeof prefsRaw === 'object' && prefsRaw.profileFreezeCore !== undefined
      ? Boolean(prefsRaw.profileFreezeCore)
      : true;
  return { brandInfo, freezeCore };
}

async function loadInstagramAccountForBrand(brandId: string) {
  const instagramAccount = await prisma.socialAccount.findFirst({
    where: { brandId, platform: 'instagram' },
    select: { id: true, metadata: true },
  });
  const disconnected =
    instagramAccount && (instagramAccount.metadata as any)?.disconnected === true;
  return !instagramAccount || disconnected ? null : instagramAccount;
}

async function mapPostsForAnalysis(params: { postsRaw: any[]; brandId: string; request: any }) {
  return Promise.all(
    params.postsRaw.map(async (post) => {
      let mediaUrl = post.media_url;
      if (
        post.media_type?.toUpperCase() !== 'VIDEO' &&
        typeof post.media_url === 'string' &&
        post.media_url
      ) {
        try {
          const metadata = await buildAnalysisAssetMetadata({
            brandId: params.brandId,
            contentId: post.id,
            generatedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
          });
          const asset = await importImageFromExternalUrl(post.media_url, metadata);
          mediaUrl = asset.url;
        } catch (error: unknown) {
          params.request.log.warn(
            { err: error, postId: post.id },
            'Failed to cache image via assets service'
          );
        }
      }
      return {
        id: post.id,
        caption: post.caption,
        hashtags: post.hashtags,
        timestamp: post.timestamp,
        like_count: post.like_count,
        comments_count: post.comments_count,
        media_type: post.media_type,
        media_url: mediaUrl,
      };
    })
  );
}

async function enqueueBrandAnalysisRequest(params: {
  brandId: string;
  requestedBy?: string;
  force?: boolean;
  maxPosts: number;
  countryCode?: string | null;
  freezeCore: boolean;
  posts: any[];
}) {
  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          DetailType: 'brand.analysis.requested',
          Source: 'postolio.brand',
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify({
            brandId: params.brandId,
            requestedBy: params.requestedBy,
            options: { force: params.force, maxPosts: params.maxPosts },
            brandInfo: {
              countryCode: params.countryCode || null,
              freezeCore: params.freezeCore,
            },
            posts: params.posts,
          }),
        },
      ],
    })
  );
}

function createStartAnalysisHandler() {
  return async (request: any, reply: any) => {
    if (!EVENT_BUS_NAME) {
      return reply.code(501).send({ error: 'Brand analysis not configured in this environment' });
    }
    const { brandId } = request.params as { brandId: string };
    const { force, maxPosts = 20 } = (request.body || {}) as { force?: boolean; maxPosts?: number };
    const brand = await assertBrandOwnership(request.user!.id, brandId);
    const instagramAccount = await loadInstagramAccountForBrand(brandId);
    if (!instagramAccount) {
      return reply.code(400).send({ error: 'Instagram not connected for this brand' });
    }

    const postsRaw = await instagramService.getRecentPosts(
      { id: brand.id },
      Math.min(maxPosts, 25)
    );
    const context = await loadBrandAnalysisContext(brandId);
    const posts = await mapPostsForAnalysis({ postsRaw, brandId: brand.id, request });
    await enqueueBrandAnalysisRequest({
      brandId,
      requestedBy: request.user?.id,
      force,
      maxPosts,
      countryCode: context.brandInfo?.countryCode || null,
      freezeCore: context.freezeCore,
      posts,
    });
    return reply.code(202).send({ jobId: undefined, status: 'accepted' });
  };
}

function createStatusHandler() {
  return async (request: any, reply: any) => {
    if (!JOBS_TABLE) {
      return reply.send({ jobId: null, status: 'none' });
    }
    const { brandId } = request.params as { brandId: string };
    try {
      const res = await doc.send(
        new QueryCommand({
          TableName: JOBS_TABLE,
          IndexName: 'GSI1',
          KeyConditionExpression: 'brandId = :bid',
          ExpressionAttributeValues: { ':bid': brandId },
          ScanIndexForward: false,
          Limit: 1,
        })
      );
      const item = res.Items?.[0];
      if (!item) {
        return reply.send({ jobId: null, status: 'none' });
      }
      return reply.send({
        jobId: item.jobId,
        status: item.status,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        error: item.errorMessage,
      });
    } catch (error: unknown) {
      request.log.error(
        { err: error, brandId, table: JOBS_TABLE, index: 'GSI1' },
        'Failed to fetch latest job'
      );
      return reply.code(500).send({ error: 'Failed to fetch job status' });
    }
  };
}

async function respondWithProjection(brandId: string, request: any, reply: any) {
  try {
    const projection = await prisma.brandStyleProfileProjection.findUnique({ where: { brandId } });
    if (!projection?.summaryProjection) {
      return reply.code(404).send({ error: 'No profile found' });
    }
    return reply.send(projection.summaryProjection);
  } catch (error: unknown) {
    request.log.error({ err: error, brandId }, 'Failed to fetch profile projection');
    return reply.code(500).send({ error: 'Failed to fetch latest profile' });
  }
}

function createLatestProfileHandler() {
  return async (request: any, reply: any) => {
    const { brandId } = request.params as { brandId: string };
    if (!PROFILES_TABLE) {
      return respondWithProjection(brandId, request, reply);
    }
    try {
      const res = await doc.send(
        new QueryCommand({
          TableName: PROFILES_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': profilePk(brandId) },
          ScanIndexForward: false,
          Limit: 1,
        })
      );
      const item = res.Items?.[0];
      if (!item) {
        return respondWithProjection(brandId, request, reply);
      }
      return reply.send((item as { profile?: unknown }).profile || item);
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Failed to fetch latest profile from Dynamo');
      return respondWithProjection(brandId, request, reply);
    }
  };
}

function createVisualStylesHandler() {
  return async (request: any, reply: any) => {
    if (!PROFILES_TABLE) {
      return reply.send({ inferredStyles: [], hasAnalysis: false });
    }
    const { brandId } = request.params as { brandId: string };
    try {
      const res = await doc.send(
        new QueryCommand({
          TableName: PROFILES_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': profilePk(brandId) },
          ScanIndexForward: false,
          Limit: 1,
        })
      );
      const item = res.Items?.[0];
      if (!item) {
        return reply.send({ inferredStyles: [], hasAnalysis: false });
      }
      const profile = (item.profile || item) as {
        visual?: { inferredStyles?: Array<{ emoji: string; title: string; description: string }> };
      };
      return reply.send({
        inferredStyles: profile.visual?.inferredStyles || [],
        hasAnalysis: true,
      });
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Failed to fetch visual styles');
      return reply.code(500).send({ error: 'Failed to fetch visual styles' });
    }
  };
}

function createProfilesHandler() {
  return async (request: any, reply: any) => {
    if (!PROFILES_TABLE) {
      return reply.send({ items: [], nextCursor: undefined });
    }
    const { brandId } = request.params as { brandId: string };
    const { limit = 20, cursor } = (request.query || {}) as { limit?: number; cursor?: string };
    try {
      const params: QueryCommandInput = {
        TableName: PROFILES_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': profilePk(brandId) },
        ScanIndexForward: false,
        Limit: limit,
      };
      if (cursor) {
        (params as Record<string, unknown>).ExclusiveStartKey = JSON.parse(
          Buffer.from(cursor, 'base64').toString('utf8')
        );
      }
      const res = await doc.send(new QueryCommand(params));
      const items = (res.Items || []).map((it) => (it as { profile?: unknown }).profile ?? it);
      const nextCursor = res.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64')
        : undefined;
      return reply.send({ items, nextCursor });
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Failed to list profiles');
      return reply.code(500).send({ error: 'Failed to list profiles' });
    }
  };
}

function createDiffHandler() {
  return async (request: any, reply: any) => {
    if (!PROFILES_TABLE) {
      return reply.code(404).send({ error: 'Profiles not found' });
    }
    const { brandId, a, b } = request.params as { brandId: string; a: string; b: string };
    try {
      const [resA, resB] = await Promise.all([
        doc.send(
          new QueryCommand({
            TableName: PROFILES_TABLE,
            KeyConditionExpression: 'PK = :pk AND SK = :sk',
            ExpressionAttributeValues: { ':pk': profilePk(brandId), ':sk': profileSk(Number(a)) },
            Limit: 1,
          })
        ),
        doc.send(
          new QueryCommand({
            TableName: PROFILES_TABLE,
            KeyConditionExpression: 'PK = :pk AND SK = :sk',
            ExpressionAttributeValues: { ':pk': profilePk(brandId), ':sk': profileSk(Number(b)) },
            Limit: 1,
          })
        ),
      ]);
      const itemA =
        (resA.Items?.[0] as { profile?: unknown } | undefined)?.profile ?? resA.Items?.[0];
      const itemB =
        (resB.Items?.[0] as { profile?: unknown } | undefined)?.profile ?? resB.Items?.[0];
      if (!itemA || !itemB) {
        return reply.code(404).send({ error: 'Profiles not found' });
      }
      const changedFields = [...new Set([...Object.keys(itemA), ...Object.keys(itemB)])].filter(
        (key) =>
          JSON.stringify((itemA as Record<string, unknown>)[key]) !==
          JSON.stringify((itemB as Record<string, unknown>)[key])
      );
      return reply.send({ changedFields });
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Failed to diff profiles');
      return reply.code(500).send({ error: 'Failed to diff profiles' });
    }
  };
}

function registerBrandAnalysisStartRoute(fastify: FastifyInstance) {
  fastify.post<{ Params: { brandId: string }; Body: { force?: boolean; maxPosts?: number } }>(
    '/:brandId/analysis',
    { preHandler: fastify.authenticate },
    createStartAnalysisHandler()
  );
}

function registerBrandAnalysisStatusRoute(fastify: FastifyInstance) {
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/analysis/status',
    { preHandler: fastify.authenticate },
    createStatusHandler()
  );
}

function registerBrandAnalysisProfileRoute(fastify: FastifyInstance) {
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/analysis/profile',
    { preHandler: fastify.authenticate },
    createLatestProfileHandler()
  );
}

function registerBrandAnalysisVisualStylesRoute(fastify: FastifyInstance) {
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/analysis/visual-styles',
    { preHandler: fastify.authenticate },
    createVisualStylesHandler()
  );
}

function registerBrandAnalysisProfilesRoute(fastify: FastifyInstance) {
  fastify.get<{ Params: { brandId: string }; Querystring: { limit?: number; cursor?: string } }>(
    '/:brandId/analysis/profiles',
    { preHandler: fastify.authenticate },
    createProfilesHandler()
  );
}

function registerBrandAnalysisDiffRoute(fastify: FastifyInstance) {
  fastify.get<{ Params: { brandId: string; a: string; b: string } }>(
    '/:brandId/analysis/diff/:a/:b',
    { preHandler: fastify.authenticate },
    createDiffHandler()
  );
}

const brandAnalysisNested: FastifyPluginAsync = async (fastify) => {
  registerBrandAnalysisStartRoute(fastify);
  registerBrandAnalysisStatusRoute(fastify);
  registerBrandAnalysisProfileRoute(fastify);
  registerBrandAnalysisVisualStylesRoute(fastify);
  registerBrandAnalysisProfilesRoute(fastify);
  registerBrandAnalysisDiffRoute(fastify);
};

export default brandAnalysisNested;
