import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { Prisma } from '@postolio/database';
import type { FastifyInstance } from 'fastify';

import { instagramService } from '../../services/instagram.js';
import { importImageFromExternalUrl } from '../../services/assets-media.js';
import { buildAnalysisAssetMetadata } from '../../services/brand-analysis-assets.js';
import { ensureDefaultQueueWithStarterSchedule } from '../../services/publishing-queue/default-schedule.js';
import { redisService } from '../../services/redis.js';
import {
  EVENT_BUS_NAME,
  eventBridge,
  prisma,
  type FacebookPage,
  type InstagramProfile,
} from './shared.js';

export async function persistConnectedAccount(params: {
  brand: any;
  preferences: Record<string, unknown>;
  instagramAccountId: string;
  pageWithInstagram: FacebookPage;
  instagramProfile: InstagramProfile;
  tokenExpiresAt: Date;
}) {
  const updatedBrand = await prisma.brand.update({
    where: { id: params.brand.id },
    data: {
      preferences: {
        ...params.preferences,
        oauthState: null,
        oauthStateExpires: null,
        tokenExpiresAt: params.tokenExpiresAt.toISOString(),
      },
    },
  });

  const socialAccountMetadata = JSON.parse(
    JSON.stringify({
      ...(params.instagramProfile || {}),
      tokenExpiresAt: params.tokenExpiresAt.toISOString(),
      tokenUpdatedAt: new Date().toISOString(),
      pageId: params.pageWithInstagram.id,
      accountId: params.instagramAccountId,
    })
  ) as Prisma.InputJsonValue;

  const connectedSocialAccount = await prisma.socialAccount.upsert({
    where: {
      platform_externalAccountId: {
        platform: 'instagram',
        externalAccountId: params.instagramAccountId,
      },
    },
    create: {
      brandId: params.brand.id,
      platform: 'instagram',
      externalAccountId: params.instagramAccountId,
      externalPageId: params.pageWithInstagram.id,
      username: params.instagramProfile.username || null,
      displayName: params.instagramProfile.name || null,
      metadata: socialAccountMetadata,
    },
    update: {
      externalPageId: params.pageWithInstagram.id,
      username: params.instagramProfile.username || null,
      displayName: params.instagramProfile.name || null,
      metadata: socialAccountMetadata,
      updatedAt: new Date(),
    },
    select: { id: true },
  });

  await ensureDefaultQueueWithStarterSchedule(prisma, connectedSocialAccount.id);
  return { updatedBrand, connectedSocialAccount };
}

export function triggerInitialSync(brandId: string) {
  void (async () => {
    try {
      await redisService.set(`ig-sync-${brandId}`, Date.now().toString(), 900);
    } catch {
      // ignore
    }

    instagramService
      .syncPublishedPosts({ id: brandId }, { maxPosts: 100, maxDays: 30 })
      .catch((error) =>
        console.error(`[Instagram OAuth] Initial sync failed for brand ${brandId}:`, error)
      );
  })();
}

export function triggerBrandAnalysis(
  fastify: FastifyInstance,
  params: { brandId: string; userId: string }
) {
  void (async () => {
    try {
      const postsRaw = await instagramService.getRecentPosts({ id: params.brandId }, 20);
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
                brandId: params.brandId,
                contentId: post.id,
                generatedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
              });
              const asset = await importImageFromExternalUrl(post.media_url, metadata);
              mediaUrl = asset.url;
            } catch (error) {
              fastify.log.warn(
                { err: error, postId: post.id },
                'Failed to cache image via assets service for analysis; using original URL'
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
                brandId: params.brandId,
                requestedBy: params.userId,
                options: { reason: 'on-connect', maxPosts: 20 },
                posts,
              }),
            },
          ],
        })
      );

      fastify.log.info({ brandId: params.brandId }, 'Triggered brand analysis on connect');
    } catch (error) {
      fastify.log.warn({ err: error, brandId: params.brandId }, 'Failed to trigger brand analysis');
    }
  })();
}
