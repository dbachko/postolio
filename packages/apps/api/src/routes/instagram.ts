import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Prisma } from '@postolio/database';
import { instagramService, InstagramWebhookEvent } from '../services/instagram.js';
import crypto from 'crypto';
import { buildCdnUrl } from '../services/s3-image.js';
import { redisService } from '../services/redis.js';

import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();
const eventBridge = new EventBridge({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';
const JOBS_TABLE = process.env.BRAND_ANALYSIS_JOBS_TABLE;
const AUTO_ON_CONNECT = ['true', '1', 'yes'].includes(
  (process.env.BRAND_ANALYSIS_ON_CONNECT || '').toLowerCase()
);
const DEBOUNCE_MS = (() => {
  const n = Number(process.env.BRAND_ANALYSIS_ON_CONNECT_DEBOUNCE_MS);
  return Number.isNaN(n) || !Number.isFinite(n) ? 24 * 60 * 60 * 1000 : n; // default 24h
})();
const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } });

function ensureAuth(
  request: FastifyRequest,
  reply: FastifyReply
): request is FastifyRequest & { user: { id: string } } {
  if (!request.user || !request.user.id) {
    reply.code(401).send({ error: 'Authentication required' });
    return false;
  }
  return true;
}

// Helper function to validate webhook signatures
function validateWebhookSignature(payload: string, signature: string): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.FACEBOOK_APP_SECRET || 'test_secret')
    .update(payload)
    .digest('hex');

  const receivedSignature = signature.replace('sha256=', '');
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(receivedSignature, 'hex')
  );
}

const instagram: FastifyPluginAsync = async function (fastify) {
  // Get Instagram connection status and profile
  fastify.get(
    '/status/:brandId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const { brandId } = request.params as { brandId: string };
        const { refresh } = request.query as { refresh?: string };

        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: request.user.id,
          },
        });

        if (!brand) {
          return reply.status(404).send({ error: 'Brand not found' });
        }

        const connected = instagramService.isConfigured(brand);
        let profile = null;

        if (connected) {
          if (refresh === 'true') {
            // Fetch fresh profile data from Instagram API
            try {
              const freshProfile = await instagramService.getProfile(brand);

              // Update database with fresh profile data
              await prisma.brand.update({
                where: { id: brandId },
                data: {
                  // Store as JSON (Prisma accepts plain objects); fallback to null if unexpected type
                  instagramProfileData:
                    freshProfile && typeof freshProfile === 'object'
                      ? JSON.parse(JSON.stringify(freshProfile))
                      : Prisma.JsonNull,
                },
              });

              profile = freshProfile;
            } catch (error) {
              console.error('Failed to refresh Instagram profile:', error);
              // Fallback to cached data if refresh fails
              profile = brand.instagramProfileData;
            }
          } else {
            // Use cached profile data
            profile = brand.instagramProfileData;
          }
        }

        reply.send({
          connected,
          profile,
        });

        // Auto-trigger on connect with debounce (fire-and-forget; response already sent)
        if (connected && AUTO_ON_CONNECT) {
          try {
            const brandId = (request.params as { brandId: string }).brandId;
            // Debounce via Jobs table if available
            let shouldTrigger = true;
            if (JOBS_TABLE) {
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
              const last = res.Items?.[0] as { requestedAt?: string; status?: string } | undefined;
              if (last?.status === 'running') shouldTrigger = false;
              const lastTs = last?.requestedAt ? Date.parse(last.requestedAt) : NaN;
              if (!Number.isNaN(lastTs) && Date.now() - lastTs < DEBOUNCE_MS) shouldTrigger = false;
            }
            if (shouldTrigger) {
              // Fetch a small sample of posts to include in the event detail
              const postsRaw = await instagramService.getRecentPosts(brand, 20);
              const posts = postsRaw.map((p) => ({
                id: p.id,
                caption: p.caption,
                hashtags: p.hashtags,
                timestamp: p.timestamp,
                like_count: p.like_count,
                comments_count: p.comments_count,
                media_type: p.media_type,
                media_url: p.media_url,
              }));
              await eventBridge.send(
                new PutEventsCommand({
                  Entries: [
                    {
                      DetailType: 'brand.analysis.requested',
                      Source: 'postolio.brand',
                      EventBusName: EVENT_BUS_NAME,
                      Detail: JSON.stringify({
                        brandId,
                        requestedBy: request.user.id,
                        options: { reason: 'on-connect', maxPosts: 20 },
                        posts,
                      }),
                    },
                  ],
                })
              );
              request.log.info({ brandId }, 'Auto-triggered brand analysis on connect');
            }
          } catch (e) {
            request.log.warn({ err: e }, 'Failed auto on-connect brand analysis trigger');
          }
        }
      } catch (error) {
        reply.status(500).send({
          error: 'Failed to fetch Instagram profile',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Get recent Instagram posts for a brand
  fastify.get(
    '/posts/:brandId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const { brandId } = request.params as { brandId: string };
        const { limit = 25 } = request.query as { limit?: number };

        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: request.user.id,
          },
        });

        if (!brand) {
          return reply.status(404).send({ error: 'Brand not found' });
        }

        if (!instagramService.isConfigured(brand)) {
          return reply.status(400).send({ error: 'Instagram not connected for this brand' });
        }

        const posts = await instagramService.getRecentPosts(brand, limit);

        reply.send({ posts });
      } catch (error) {
        reply.status(500).send({
          error: 'Failed to fetch Instagram posts',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Refresh Instagram access token
  fastify.post(
    '/refresh-token',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const { brandId } = request.body as { brandId: string };

        if (!brandId) {
          return reply.status(400).send({ error: 'brandId is required' });
        }

        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: request.user.id,
          },
        });

        if (!brand) {
          return reply.status(404).send({ error: 'Brand not found' });
        }

        if (!brand.instagramAccountId) {
          return reply.status(400).send({ error: 'Instagram not connected' });
        }

        // Token refresh is now handled automatically by Token Service
        // when fetching tokens that are close to expiry
        return reply.send({
          success: true,
          message: 'Token refresh is handled automatically by Token Service',
        });
      } catch (error) {
        reply.status(500).send({
          error: 'Failed to refresh Instagram token',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Publish content to Instagram
  fastify.post<{ Params: { contentId: string } }>(
    '/publish/:contentId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const { contentId } = request.params;

        if (!contentId) {
          return reply.status(400).send({ error: 'contentId is required' });
        }

        // Get content and verify ownership
        const content = await prisma.content.findFirst({
          where: {
            id: contentId,
            brand: {
              userId: request.user.id,
            },
          },
          include: {
            brand: true,
          },
        });

        if (!content) {
          return reply.status(404).send({ error: 'Content not found' });
        }

        if (content.status !== 'scheduled' && content.status !== 'draft') {
          return reply.status(400).send({
            error: 'Content must be scheduled or in draft status before publishing',
          });
        }

        // Check if brand has Instagram connection
        if (!instagramService.isConfigured(content.brand)) {
          return reply.status(400).send({
            error: 'Instagram account not connected to this brand',
          });
        }

        // Enhanced content validation
        if (!content.s3ImageKey) {
          return reply.status(400).send({
            error: 'Image is required for Instagram posting',
            details: 'Content must have a valid image before publishing',
            retryable: false,
          });
        }

        if (!content.caption || content.caption.trim().length === 0) {
          return reply.status(400).send({
            error: 'Caption is required for Instagram posting',
            details: 'Content must have a non-empty caption',
            retryable: false,
          });
        }

        if (!content.hashtags || content.hashtags.length === 0) {
          return reply.status(400).send({
            error: 'At least one hashtag is required for Instagram posting',
            details: 'Content must include hashtags for better reach',
            retryable: false,
          });
        }

        // Build CDN URL from S3 key
        const cdnImageUrl = buildCdnUrl(content.s3ImageKey);
        if (!cdnImageUrl) {
          return reply.status(500).send({
            error: 'Failed to generate image URL',
            details: 'Unable to construct CDN URL from S3 key',
            retryable: false,
          });
        }

        // Publish to Instagram
        const publishResult = await instagramService.publishMedia(content.brand, {
          cdnImageUrl,
          caption: content.caption,
          hashtags: content.hashtags,
        });

        // Update content status
        const updatedContent = await prisma.content.update({
          where: { id: contentId },
          data: {
            status: 'published',
            postedAt: new Date(),
            instagramPostId: publishResult.id,
            instagramPermalink: publishResult.permalink,
          },
        });

        reply.send({
          success: true,
          content: updatedContent,
          instagram: publishResult,
        });
      } catch (error) {
        console.error('Instagram publish error:', error);

        const errorMessage =
          error instanceof Error ? error.message : 'Failed to publish to Instagram';
        const isRetryable =
          !errorMessage.includes('permission') &&
          !errorMessage.includes('invalid token') &&
          !errorMessage.includes('not found');

        reply.status(500).send({
          error: errorMessage,
          retryable: isRetryable,
          timestamp: new Date().toISOString(),
          details: 'Check Instagram connection and try again',
        });
      }
    }
  );

  // Get Instagram insights for a post
  fastify.get(
    '/insights/:brandId/:postId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const { brandId, postId } = request.params as {
          brandId: string;
          postId: string;
        };

        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: request.user.id,
          },
        });

        if (!brand) {
          return reply.status(404).send({ error: 'Brand not found' });
        }

        if (!instagramService.isConfigured(brand)) {
          return reply.status(400).send({
            error: 'Instagram account not connected',
          });
        }

        const insights = await instagramService.getMediaInsights(brand, postId);

        reply.send({ insights });
      } catch (error) {
        reply.status(500).send({
          error: 'Failed to fetch Instagram insights',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Get sync status for a brand
  fastify.get(
    '/sync-status/:brandId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const { brandId } = request.params as { brandId: string };

        // Validate brand ownership
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: request.user.id,
          },
        });

        if (!brand) {
          return reply.status(404).send({
            error: 'Brand not found or access denied',
          });
        }

        // Check cooldown status
        const cooldownKey = `instagram_sync:${brandId}`;
        const lastSyncTime = await redisService.get(cooldownKey);

        let cooldownRemaining = 0;
        let canSync = true;

        if (lastSyncTime) {
          const timeSinceSync = Date.now() - parseInt(lastSyncTime);
          const cooldownMs = 15 * 60 * 1000; // 15 minutes

          if (timeSinceSync < cooldownMs) {
            cooldownRemaining = Math.ceil((cooldownMs - timeSinceSync) / 1000);
            canSync = false;
          }
        }

        // Get last sync metadata
        const metadataKey = `instagram_sync_metadata:${brandId}`;
        const metadataJson = await redisService.get(metadataKey);
        let lastSync = null;

        if (metadataJson) {
          try {
            const metadata = JSON.parse(metadataJson);
            lastSync = {
              timestamp: metadata.timestamp,
              duration: metadata.duration,
              results: metadata.results,
              options: metadata.options,
            };
          } catch (error) {
            console.error('Failed to parse sync metadata:', error);
          }
        }

        reply.send({
          canSync,
          cooldownRemaining,
          lastSync,
          instagram: {
            connected: instagramService.isConfigured(brand),
            accountId: brand.instagramAccountId,
          },
        });
      } catch (error) {
        console.error('Sync status endpoint error:', error);
        reply.status(500).send({
          error: 'Failed to retrieve sync status',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Sync published Instagram posts
  fastify.post(
    '/sync-posts/:brandId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const { brandId } = request.params as { brandId: string };
        const { maxPosts, maxDays } = request.body as {
          maxPosts?: number;
          maxDays?: number;
        };

        // Validate brand ownership
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: request.user.id,
          },
        });

        if (!brand) {
          return reply.status(404).send({
            error: 'Brand not found or access denied',
          });
        }

        if (!instagramService.isConfigured(brand)) {
          return reply.status(400).send({
            error: 'Instagram not connected for this brand',
          });
        }

        // Check sync cooldown using Redis
        const cooldownKey = `instagram_sync:${brandId}`;
        const lastSync = await redisService.get(cooldownKey);
        if (lastSync) {
          const timeSinceSync = Date.now() - parseInt(lastSync);
          const cooldownMs = 15 * 60 * 1000; // 15 minutes

          if (timeSinceSync < cooldownMs) {
            const remainingMinutes = Math.ceil((cooldownMs - timeSinceSync) / 60000);
            return reply.status(429).send({
              error: 'Sync already in progress or completed recently',
              message: `Please wait ${remainingMinutes} more minutes before syncing again`,
              retryAfter: new Date(parseInt(lastSync) + cooldownMs).toISOString(),
            });
          }
        }

        // Set sync timestamp
        await redisService.set(cooldownKey, Date.now().toString(), 900); // 15 min TTL

        // Perform sync
        const results = await instagramService.syncPublishedPosts(brand, {
          maxPosts: maxPosts || 100,
          maxDays: maxDays || 30,
        });

        // Return results
        reply.send({
          success: true,
          results,
          message: `Synced ${results.synced} posts, skipped ${results.skipped}, failed ${results.failed}`,
        });
      } catch (error) {
        console.error('Sync posts endpoint error:', error);
        reply.status(500).send({
          error: 'Failed to sync Instagram posts',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Disconnect Instagram from brand
  fastify.post(
    '/disconnect',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const { brandId } = request.body as { brandId: string };

        if (!brandId) {
          return reply.status(400).send({ error: 'brandId is required' });
        }

        // Verify brand ownership and disconnect
        const updatedBrand = await prisma.brand.updateMany({
          where: {
            id: brandId,
            userId: request.user.id,
          },
          data: {
            instagramPageId: null,
            instagramAccountId: null,
            instagramProfileData: { set: null },
          },
        });

        if (updatedBrand.count === 0) {
          return reply.status(404).send({ error: 'Brand not found' });
        }

        reply.send({ success: true });
      } catch (error) {
        reply.status(500).send({
          error: 'Failed to disconnect Instagram account',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Handle Instagram webhooks
  fastify.get<{
    Querystring: {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };
  }>('/webhooks', async function (request, reply) {
    const mode = request.query['hub.mode'];
    const token = request.query['hub.verify_token'];
    const challenge = request.query['hub.challenge'];

    // Verify webhook
    if (mode === 'subscribe' && token === process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN) {
      reply.send(challenge);
    } else {
      reply.status(403).send('Forbidden');
    }
  });

  fastify.post('/webhooks', async function (request, reply) {
    const signature = request.headers['x-hub-signature-256'] as string;
    const payload = JSON.stringify(request.body);

    if (!signature || !validateWebhookSignature(payload, signature)) {
      return reply.status(403).send('Forbidden');
    }

    try {
      const bodyUnknown = request.body as unknown;
      type MinimalWebhook = { object?: string; entry?: unknown };
      let event: MinimalWebhook = {};
      if (bodyUnknown && typeof bodyUnknown === 'object') {
        const rec = bodyUnknown as Record<string, unknown>;
        event = {
          object: typeof rec.object === 'string' ? rec.object : undefined,
          entry: rec.entry,
        };
      }
      await instagramService.handleWebhookEvent(event as unknown as InstagramWebhookEvent);
      reply.send('OK');
    } catch {
      reply.status(500).send('Error processing webhook');
    }
  });
};

export default instagram;
