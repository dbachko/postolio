import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';

import { getDatabaseClient } from '../config/database.js';
import { buildAnalysisAssetMetadata } from '../services/brand-analysis-assets.js';
import { importImageFromExternalUrl } from '../services/assets-media.js';
import { instagramService } from '../services/instagram.js';
import { assertBrandOwnership } from '../services/ownership.js';

const eventBridge = new EventBridge({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';
const PROFILES_TABLE = process.env.BRAND_STYLE_PROFILES_TABLE!;
const JOBS_TABLE = process.env.BRAND_ANALYSIS_JOBS_TABLE!;

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } });
const prisma = getDatabaseClient();

function profilePk(brandId: string): string {
  return `BRAND#${brandId}`;
}

function profileSk(version: number): string {
  return `VERSION#${version.toString().padStart(6, '0')}`;
}

type BrandRequest = FastifyRequest<{ Params: { brandId: string } }>;

type StartAnalysisRequest = FastifyRequest<{
  Params: { brandId: string };
  Body: { force?: boolean; maxPosts?: number };
}>;

async function handleStartAnalysis(request: StartAnalysisRequest, reply: FastifyReply) {
  const { brandId } = request.params;
  const { force, maxPosts = 20 } = request.body || {};
  const brand = await assertBrandOwnership(request.user!.id, brandId);

  const instagramAccount = await prisma.socialAccount.findFirst({
    where: { brandId, platform: 'instagram' },
    select: { id: true, metadata: true },
  });
  const isDisconnected =
    instagramAccount && (instagramAccount.metadata as any)?.disconnected === true;
  if (!instagramAccount || isDisconnected) {
    return reply.code(400).send({ error: 'Instagram not connected for this brand' });
  }

  const postsRaw = await instagramService.getRecentPosts({ id: brand.id }, Math.min(maxPosts, 25));
  const posts = await Promise.all(
    postsRaw.map(async (post) => {
      let mediaUrl = post.media_url;
      if (
        post.media_type?.toUpperCase() !== 'VIDEO' &&
        typeof post.media_url === 'string' &&
        post.media_url
      ) {
        try {
          const metadata = await buildAnalysisAssetMetadata({
            brandId: brand.id,
            contentId: post.id,
            generatedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
          });
          const asset = await importImageFromExternalUrl(post.media_url, metadata);
          mediaUrl = asset.url;
        } catch (error) {
          request.log.warn(
            { err: error, postId: post.id },
            'Failed to cache image via assets service; falling back to original URL'
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

  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          DetailType: 'brand.analysis.requested',
          Source: 'postolio.brand',
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify({
            brandId,
            requestedBy: request.user?.id,
            options: { force, maxPosts },
            posts,
          }),
        },
      ],
    })
  );

  return reply.code(202).send({ jobId: undefined, status: 'accepted' });
}

async function handleLatestStatus(request: BrandRequest, reply: FastifyReply) {
  const { brandId } = request.params;

  try {
    const result = await doc.send(
      new QueryCommand({
        TableName: JOBS_TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'brandId = :bid',
        ExpressionAttributeValues: { ':bid': brandId },
        ScanIndexForward: false,
        Limit: 1,
      })
    );

    const item = result.Items?.[0];
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
  } catch (error) {
    request.log.error({ err: error }, 'Failed to fetch latest job');
    return reply.code(500).send({ error: 'Failed to fetch job status' });
  }
}

async function getLatestProfileRecord(brandId: string) {
  const result = await doc.send(
    new QueryCommand({
      TableName: PROFILES_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': profilePk(brandId) },
      ScanIndexForward: false,
      Limit: 1,
    })
  );

  return result.Items?.[0] || null;
}

async function handleLatestProfile(request: BrandRequest, reply: FastifyReply) {
  try {
    const item = await getLatestProfileRecord(request.params.brandId);
    if (!item) {
      return reply.code(404).send({ error: 'No profile found' });
    }

    return reply.send(item.profile || item);
  } catch (error) {
    request.log.error({ err: error }, 'Failed to fetch latest profile');
    return reply.code(500).send({ error: 'Failed to fetch latest profile' });
  }
}

async function handleVisualStyles(request: BrandRequest, reply: FastifyReply) {
  try {
    const item = await getLatestProfileRecord(request.params.brandId);
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
  } catch (error) {
    request.log.error({ err: error }, 'Failed to fetch visual styles');
    return reply.code(500).send({ error: 'Failed to fetch visual styles' });
  }
}

async function handleProfileList(
  request: FastifyRequest<{
    Params: { brandId: string };
    Querystring: { limit?: number; cursor?: string };
  }>,
  reply: FastifyReply
) {
  const { brandId } = request.params;
  const { limit = 20, cursor } = request.query || {};

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

    const result = await doc.send(new QueryCommand(params));
    const items = (result.Items || []).map(
      (item) => (item as { profile?: unknown }).profile ?? item
    );
    const nextCursor = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined;

    return reply.send({ items, nextCursor });
  } catch (error) {
    request.log.error({ err: error }, 'Failed to list profiles');
    return reply.code(500).send({ error: 'Failed to list profiles' });
  }
}

async function handleProfileDiff(
  request: FastifyRequest<{ Params: { brandId: string; a: string; b: string } }>,
  reply: FastifyReply
) {
  const { brandId, a, b } = request.params;

  try {
    const verA = Number(a);
    const verB = Number(b);

    const [resA, resB] = await Promise.all([
      doc.send(
        new QueryCommand({
          TableName: PROFILES_TABLE,
          KeyConditionExpression: 'PK = :pk AND SK = :sk',
          ExpressionAttributeValues: { ':pk': profilePk(brandId), ':sk': profileSk(verA) },
          Limit: 1,
        })
      ),
      doc.send(
        new QueryCommand({
          TableName: PROFILES_TABLE,
          KeyConditionExpression: 'PK = :pk AND SK = :sk',
          ExpressionAttributeValues: { ':pk': profilePk(brandId), ':sk': profileSk(verB) },
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

    const changedFields: string[] = [];
    const objA = itemA as Record<string, unknown>;
    const objB = itemB as Record<string, unknown>;

    for (const key of new Set([...Object.keys(objA), ...Object.keys(objB)])) {
      if (JSON.stringify(objA[key]) !== JSON.stringify(objB[key])) {
        changedFields.push(key);
      }
    }

    return reply.send({ changedFields });
  } catch (error) {
    request.log.error({ err: error }, 'Failed to diff profiles');
    return reply.code(500).send({ error: 'Failed to diff profiles' });
  }
}

function registerBrandAnalysisRoutes(fastify: FastifyInstance): void {
  fastify.post<{ Params: { brandId: string }; Body: { force?: boolean; maxPosts?: number } }>(
    '/:brandId/start',
    { preHandler: fastify.authenticate },
    handleStartAnalysis
  );

  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/status',
    { preHandler: fastify.authenticate },
    handleLatestStatus
  );

  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/profile',
    { preHandler: fastify.authenticate },
    handleLatestProfile
  );

  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/visual-styles',
    { preHandler: fastify.authenticate },
    handleVisualStyles
  );

  fastify.get<{ Params: { brandId: string }; Querystring: { limit?: number; cursor?: string } }>(
    '/:brandId/profiles',
    { preHandler: fastify.authenticate },
    handleProfileList
  );

  fastify.get<{ Params: { brandId: string; a: string; b: string } }>(
    '/:brandId/diff/:a/:b',
    { preHandler: fastify.authenticate },
    handleProfileDiff
  );
}

const brandAnalysisRoutes: FastifyPluginAsync = async (fastify) => {
  registerBrandAnalysisRoutes(fastify);
};

export default brandAnalysisRoutes;
