import { getDatabaseClient } from '../config/database.js';
import {
  generateInstagramContent,
  type ContentGenerationRequest,
  type GeneratedContent,
} from './content-generator.js';
import { getStatusBroadcaster } from './broadcast-registry.js';
import { importImageFromExternalUrl, attachAssetToContent } from './assets-media.js';
import { logMemoryUsage, maybeWriteHeapSnapshot } from '../utils/memory-debug.js';

const prisma = getDatabaseClient();

export interface CampaignJob {
  campaignId: string;
  userId: string;
}

class CampaignJobService {
  private runningJobs = new Set<string>();

  /**
   * Start async campaign preview generation
   */
  async startCampaignPreviewGeneration(campaignId: string, userId: string): Promise<void> {
    try {
      if (this.runningJobs.has(campaignId)) {
        console.log(`Campaign preview generation already running for ${campaignId}`);
        return;
      }

      this.runningJobs.add(campaignId);

      logMemoryUsage('campaign-jobs:startCampaignPreviewGeneration', {
        campaignId,
        runningJobs: this.runningJobs.size,
      });

      // Start the background job
      this.generateCampaignPreviewAsync(campaignId, userId)
        .catch((error) => {
          console.error(`Campaign preview generation failed for ${campaignId}:`, error);
        })
        .finally(() => {
          this.runningJobs.delete(campaignId);
        });
    } catch (error) {
      console.error(`Error initiating campaign preview generation for ${campaignId}:`, error);
      this.runningJobs.delete(campaignId);
      throw error;
    }
  }

  /**
   * Background async campaign preview generation
   */
  private async generateCampaignPreviewAsync(campaignId: string, userId: string): Promise<void> {
    try {
      console.log(`Starting async campaign preview generation for ${campaignId}`);

      // Update status to show progress
      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'creating',
          errorMessage: null,
        },
      });

      // Get campaign and validate ownership
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          brand: {
            userId,
          },
        },
        include: {
          brand: { select: { id: true, name: true, styleProfile: true } },
        },
      });

      if (!campaign) {
        throw new Error('Campaign not found or access denied');
      }

      const configRaw = campaign.config as unknown;
      const config =
        configRaw && typeof configRaw === 'object'
          ? (configRaw as { themes: string[]; style?: string })
          : { themes: [] as string[], style: undefined };

      logMemoryUsage('campaign-jobs:preview-start', {
        campaignId,
        themesCount: config.themes.length,
        styleLength: config.style ? config.style.length : 0,
      });

      // No numeric progress updates stored in DB

      // Generate preview content using themes from campaign config
      const contentRequests: ContentGenerationRequest[] = config.themes.map((theme: string) => ({
        brandId: campaign.brandId,
        count: 1,
        theme,
        style: config.style,
        campaignId: campaign.id,
      }));

      // Generate preview posts (3 posts)
      const exampleCount = 3;
      const previewRequests = contentRequests.slice(0, exampleCount);

      let examplePosts: GeneratedContent[] = [];

      for (let i = 0; i < previewRequests.length; i++) {
        const request = previewRequests[i];

        // Update progress per generated example
        // No numeric progress updates stored in DB

        if (request) {
          const content = await generateInstagramContent(campaign.brand.name, request);
          examplePosts.push(...content);
        }
      }

      // If we have fewer posts than requested, generate more with the first theme.
      // Include a safety guard so we don't loop forever if generation keeps returning 0 posts.
      let extraAttempts = 0;
      const maxExtraAttempts = 5;
      while (
        examplePosts.length < exampleCount &&
        config.themes.length > 0 &&
        extraAttempts < maxExtraAttempts
      ) {
        const additionalContent = await generateInstagramContent(campaign.brand.name, {
          brandId: campaign.brandId,
          count: 1,
          theme: config.themes[0],
          style: config.style,
          campaignId: campaign.id,
        });

        if (!additionalContent.length) {
          extraAttempts++;
          continue;
        }

        examplePosts.push(...additionalContent);
        extraAttempts++;
      }

      if (!examplePosts.length) {
        throw new Error('Failed to generate any preview content for campaign');
      }

      // Trim to exact count requested
      examplePosts = examplePosts.slice(0, exampleCount);

      // Check if preview posts already exist for this campaign
      const existingPreviews = await prisma.content.findMany({
        where: {
          campaignId: campaignId,
          scheduledAt: null,
        },
      });

      // Delete existing preview posts to replace them with new ones
      if (existingPreviews.length > 0) {
        await prisma.content.deleteMany({
          where: {
            id: {
              in: existingPreviews.map((p) => p.id),
            },
          },
        });
      }

      // Save new preview posts to database
      for (const post of examplePosts) {
        console.log(
          'Saving post to database:',
          JSON.stringify({
            caption: post.caption?.substring(0, 50) + '...',
            hashtags: post.hashtags?.length || 0,
            hasImageUrl: !!post.imageUrl,
          })
        );

        const created = await prisma.content.create({
          data: {
            caption: post.caption,
            hashtags: post.hashtags,
            brandId: campaign.brandId,
            campaignId: campaign.id,
            status: 'draft', // Preview posts start as draft
            generationParams: {
              theme: config.themes?.[0] || 'preview',
              style: config.style,
              campaignGenerated: true,
              isPreview: true,
              imagePrompt: post.imagePrompt,
              campaignType:
                (campaign as unknown as { campaignType?: string | null }).campaignType || undefined,
            },
          },
        });

        // Deferred asset import (OOM optimization)
        if (post.imageUrl && post.imageMetadata) {
          const contentId = created.id;
          const { imageUrl, imageMetadata } = post;

          // Fire-and-forget asset import
          importImageFromExternalUrl(imageUrl, {
            contentId,
            brandId: campaign.brandId,
            campaignId: campaign.id,
            source: imageMetadata.source,
            originalPrompt: imageMetadata.originalPrompt,
          })
            .then(async (asset) => {
              await attachAssetToContent({ contentId, asset });
              console.log(`[Preview] Asset imported for content ${contentId}`, {
                campaignId: campaign.id,
                assetId: asset.id,
              });
            })
            .catch((error) => {
              const err = error instanceof Error ? error : new Error(String(error));
              console.error(`[Preview] Failed to import asset for content ${contentId}:`, {
                campaignId: campaign.id,
                error: { name: err.name, message: err.message },
              });
            });
        }

        // Broadcast content created as draft
        try {
          const b = getStatusBroadcaster();
          if (b) {
            await b.broadcastStatusChange(created.id, campaign.brandId, 'draft', 'draft', {
              isNew: true,
              isPreview: true,
              campaignId: campaign.id,
            } as unknown as Record<string, unknown>);
          }
        } catch (e) {
          console.warn('Broadcast content-created (draft) failed or skipped:', e);
        }
      }

      // Mark campaign as ready for preview
      const updated = await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'preview',
          previewGenerated: true,
          errorMessage: null,
        },
      });
      // Broadcast final status change creating -> preview
      try {
        const b = getStatusBroadcaster();
        if (b) {
          await b.broadcastCampaignStatusChange(
            campaignId,
            updated.brandId,
            'creating',
            'preview',
            { previewGenerated: true }
          );
        }
      } catch (e) {
        console.warn('Failed to broadcast campaign preview-ready status; continuing', e);
      }

      logMemoryUsage('campaign-jobs:preview-completed', {
        campaignId,
        examplePostCount: examplePosts.length,
      });

      console.log(`Campaign preview generation completed for ${campaignId}`);
    } catch (error) {
      console.error(`Campaign preview generation failed for ${campaignId}:`, error);

      logMemoryUsage('campaign-jobs:preview-error', {
        campaignId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      // Optional: capture a heap snapshot for this failure when enabled
      void maybeWriteHeapSnapshot(`campaign-preview-error-${campaignId}`);

      const failed = await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error occurred',
        },
      });
      // Broadcast failure (status change is still useful)
      try {
        const b = getStatusBroadcaster();
        if (b) {
          await b.broadcastCampaignStatusChange(campaignId, failed.brandId, 'creating', 'failed', {
            errorMessage: failed.errorMessage ?? 'Campaign preview generation failed',
          });
        }
      } catch (e) {
        console.warn('Failed to broadcast campaign failed status; continuing', e);
      }
    }
  }

  /**
   * Check if a campaign job is currently running
   */
  isJobRunning(campaignId: string): boolean {
    return this.runningJobs.has(campaignId);
  }

  // WebSocket events handle realtime updates
}

export const campaignJobService = new CampaignJobService();
