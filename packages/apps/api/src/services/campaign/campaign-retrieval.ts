import { eventEmitter } from '../event-emitter.js';
import { getDatabaseClient } from '../../config/database.js';
import { logger as baseLogger } from '@postolio/logger';
import { APIError } from '@postolio/errors';
import { CAMPAIGN_PREVIEW_STUCK_THRESHOLD_MS } from './campaign-constants.js';
import {
  checkConcurrentEdit as checkConcurrentEditSession,
  startEditSession as startEditSessionTracking,
} from './campaign-edit-sessions.js';

const prisma = getDatabaseClient();
const logger = baseLogger.child({ module: 'campaign-retrieval-service' });

type CampaignWithContent = Record<string, unknown>;

export class CampaignRetrievalService {
  /**
   * Get campaign details
   */
  async getCampaign(campaignId: string, userId: string): Promise<CampaignWithContent | null> {
    try {
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          brand: {
            userId,
          },
        },
        include: {
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
          content: {
            select: {
              id: true,
              caption: true,
              hashtags: true,
              contentType: true,
              shareToFeed: true,
              status: true,
              scheduledAt: true,
              postedAt: true,
              createdAt: true,
              updatedAt: true,
              mediaAssets: {
                select: { assetId: true, displayOrder: true },
                orderBy: { displayOrder: 'asc' },
              },
            },
            orderBy: {
              scheduledAt: 'asc',
            },
          },
          _count: {
            select: {
              content: true,
            },
          },
        },
      });

      if (!campaign) {
        throw new APIError('Campaign not found or access denied', 'CAMPAIGN_NOT_FOUND', 404, {
          campaignId,
          userId,
        });
      }

      // Detect campaigns that are stuck in "creating" due to a previous process exit
      try {
        if (
          (campaign as { status?: string; previewGenerated?: boolean; createdAt?: Date }).status ===
            'creating' &&
          !(campaign as { status?: string; previewGenerated?: boolean; createdAt?: Date })
            .previewGenerated &&
          campaign.createdAt instanceof Date &&
          Date.now() - campaign.createdAt.getTime() > CAMPAIGN_PREVIEW_STUCK_THRESHOLD_MS
        ) {
          logger.warn('Campaign appears stuck in creating state; marking as failed', {
            campaignId,
            thresholdMinutes: CAMPAIGN_PREVIEW_STUCK_THRESHOLD_MS / 60000,
          });

          // Update status to failed instead of blindly retrying, which causes OOM loops
          await prisma.campaign.update({
            where: { id: campaignId },
            data: {
              status: 'failed',
              errorMessage: 'Preview generation timed out. Please try again.',
            },
          });

          // Notify listeners
          eventEmitter.emitCampaignStatusChanged(
            campaignId,
            campaign.brand.id,
            'creating',
            'failed',
            {
              userId,
              operation: 'campaign.stuck.recovery',
            }
          );
        }
      } catch (requeueError) {
        logger.error('Failed to handle stuck campaign', {
          campaignId,
          error: requeueError,
        });
      }

      // Build CDN URLs for all content and map to public response format
      const campaignWithUrls = {
        ...campaign,
        content: campaign.content.map((item) => ({
          id: item.id,
          caption: item.caption,
          hashtags: item.hashtags,
          primaryAssetId: item.mediaAssets?.[0]?.assetId ?? null,
          mediaAssets: item.mediaAssets ?? [],
          mediaAssetCount: item.mediaAssets?.length ?? 0,
          contentType: item.contentType ?? null,
          shareToFeed: (item as any).shareToFeed ?? null,
          status: item.status,
          scheduledAt: item.scheduledAt,
          postedAt: item.postedAt,
          createdAt: item.createdAt,
        })),
      };

      return campaignWithUrls;
    } catch (error) {
      logger.error('Get campaign error', { campaignId, userId, error });
      throw error;
    }
  }

  /**
   * Start an edit session for concurrent edit detection
   */
  startEditSession(campaignId: string, userId: string, customStartTime?: Date): Promise<void> {
    startEditSessionTracking(campaignId, userId, customStartTime);
    return Promise.resolve();
  }

  /**
   * Check for concurrent edits within the 5-minute window
   */
  checkConcurrentEdit(
    campaignId: string,
    userId: string
  ): Promise<{
    hasConflict: boolean;
    conflictUser?: string;
    warningMessage?: string;
  }> {
    return Promise.resolve(checkConcurrentEditSession(campaignId, userId));
  }
}

export const campaignRetrievalService = new CampaignRetrievalService();
