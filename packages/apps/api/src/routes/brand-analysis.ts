import { FastifyPluginAsync } from 'fastify';
import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { getDatabaseClient } from '../config/database.js';
import { instagramService } from '../services/instagram.js';
import { importImageFromExternalUrl } from '../services/assets-media.js';
import { buildAnalysisAssetMetadata } from '../services/brand-analysis-assets.js';

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

const brandAnalysisRoutes: FastifyPluginAsync = async (fastify) => {
  // Start analysis for a brand
  fastify.post<{ Params: { brandId: string }; Body: { force?: boolean; maxPosts?: number } }>(
    '/:brandId/start',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const { force, maxPosts = 20 } = request.body || {};
      // Validate brand ownership
      const brand = await prisma.brand.findFirst({
        where: { id: brandId, userId: request.user!.id },
      });
      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      // Ensure Instagram configured via SocialAccount (and not soft-disconnected)
      const instagramAccount = await prisma.socialAccount.findFirst({
        where: {
          brandId,
          platform: 'instagram',
        },
        select: { id: true, metadata: true },
      });
      const isDisconnected =
        instagramAccount && (instagramAccount.metadata as any)?.disconnected === true;
      if (!instagramAccount || isDisconnected) {
        return reply.code(400).send({ error: 'Instagram not connected for this brand' });
      }

      // Fetch recent posts and minimize payload to fit EventBridge limits
      const postsRaw = await instagramService.getRecentPosts(
        { id: brand.id },
        Math.min(maxPosts, 25)
      );
      // Pre-warm CDN URLs for image posts so vision stage can fetch publicly
      const posts = await Promise.all(
        postsRaw.map(async (p) => {
          let mediaUrl = p.media_url;
          if (
            p.media_type?.toUpperCase() !== 'VIDEO' &&
            typeof p.media_url === 'string' &&
            p.media_url
          ) {
            try {
              const metadata = await buildAnalysisAssetMetadata({
                brandId: brand.id,
                contentId: p.id,
                generatedAt: p.timestamp ? new Date(p.timestamp) : new Date(),
              });
              const asset = await importImageFromExternalUrl(p.media_url, metadata);
              mediaUrl = asset.url;
            } catch (e) {
              request.log.warn(
                { err: e, postId: p.id },
                'Failed to cache image via assets service; falling back to original URL'
              );
            }
          }
          return {
            id: p.id,
            caption: p.caption,
            hashtags: p.hashtags,
            timestamp: p.timestamp,
            like_count: p.like_count,
            comments_count: p.comments_count,
            media_type: p.media_type,
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

      return reply.code(202).send({
        jobId: undefined,
        status: 'accepted',
      });
    }
  );

  // Latest job status for a brand
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/status',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
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
        if (!item) return reply.send({ jobId: null, status: 'none' });
        return reply.send({
          jobId: item.jobId,
          status: item.status,
          startedAt: item.startedAt,
          completedAt: item.completedAt,
          error: item.errorMessage,
        });
      } catch (e) {
        request.log.error({ err: e }, 'Failed to fetch latest job');
        return reply.code(500).send({ error: 'Failed to fetch job status' });
      }
    }
  );

  // Latest profile
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/profile',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
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
        if (!item) return reply.code(404).send({ error: 'No profile found' });
        return reply.send(item.profile || item);
      } catch (e) {
        request.log.error({ err: e }, 'Failed to fetch latest profile');
        return reply.code(500).send({ error: 'Failed to fetch latest profile' });
      }
    }
  );

  // Get brand-specific visual styles for AI image generation
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/visual-styles',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
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
          visual?: {
            inferredStyles?: Array<{ emoji: string; title: string; description: string }>;
          };
        };
        const inferredStyles = profile.visual?.inferredStyles || [];
        return reply.send({ inferredStyles, hasAnalysis: true });
      } catch (e) {
        request.log.error({ err: e }, 'Failed to fetch visual styles');
        return reply.code(500).send({ error: 'Failed to fetch visual styles' });
      }
    }
  );

  // Profile list
  fastify.get<{ Params: { brandId: string }; Querystring: { limit?: number; cursor?: string } }>(
    '/:brandId/profiles',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
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
        if (cursor)
          (params as Record<string, unknown>).ExclusiveStartKey = JSON.parse(
            Buffer.from(cursor, 'base64').toString('utf8')
          );
        const res = await doc.send(new QueryCommand(params));
        const items = (res.Items || []).map((it) => (it as { profile?: unknown }).profile ?? it);
        const nextCursor = res.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64')
          : undefined;
        return reply.send({ items, nextCursor });
      } catch (e) {
        request.log.error({ err: e }, 'Failed to list profiles');
        return reply.code(500).send({ error: 'Failed to list profiles' });
      }
    }
  );

  // Diff two profiles
  fastify.get<{ Params: { brandId: string; a: string; b: string } }>(
    '/:brandId/diff/:a/:b',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
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
        if (!itemA || !itemB) return reply.code(404).send({ error: 'Profiles not found' });
        const changedFields: string[] = [];
        const objA = itemA as Record<string, unknown>;
        const objB = itemB as Record<string, unknown>;
        for (const key of new Set([...Object.keys(objA), ...Object.keys(objB)])) {
          if (JSON.stringify(objA[key]) !== JSON.stringify(objB[key])) changedFields.push(key);
        }
        return reply.send({ changedFields });
      } catch (e) {
        request.log.error({ err: e }, 'Failed to diff profiles');
        return reply.code(500).send({ error: 'Failed to diff profiles' });
      }
    }
  );
};

export default brandAnalysisRoutes;
