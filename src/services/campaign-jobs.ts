import { PrismaClient } from '@prisma/client'
import { generateInstagramContent, type ContentGenerationRequest, type GeneratedContent } from './content-generator.js'
import type { StyleProfile } from './ai.js'
import { analyzeBrandStyle } from './ai.js'

const prisma = new PrismaClient()

export interface CampaignJob {
  campaignId: string
  userId: string
}

class CampaignJobService {
  private runningJobs = new Set<string>()

  /**
   * Start async campaign preview generation
   */
  async startCampaignPreviewGeneration(campaignId: string, userId: string): Promise<void> {
    if (this.runningJobs.has(campaignId)) {
      console.log(`Campaign preview generation already running for ${campaignId}`)
      return
    }

    this.runningJobs.add(campaignId)

    // Start the background job
    this.generateCampaignPreviewAsync(campaignId, userId)
      .catch((error) => {
        console.error(`Campaign preview generation failed for ${campaignId}:`, error)
      })
      .finally(() => {
        this.runningJobs.delete(campaignId)
      })
  }

  /**
   * Background async campaign preview generation
   */
  private async generateCampaignPreviewAsync(campaignId: string, userId: string): Promise<void> {
    try {
      console.log(`Starting async campaign preview generation for ${campaignId}`)

      // Update status to show progress
      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'creating',
          progress: 10,
          errorMessage: null,
        },
      })

      // Get campaign and validate ownership
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
              styleProfile: true,
            },
          },
        },
      })

      if (!campaign) {
        throw new Error('Campaign not found or access denied')
      }

      const config = campaign.config as any
      let styleProfile = campaign.brand.styleProfile as unknown as StyleProfile

      if (!styleProfile) {
        // Generate style profile if missing (similar to autopilot service)
        console.log(`Generating style profile for brand: ${campaign.brand.name}`)
        const analysisResult = await analyzeBrandStyle([], campaign.brand.name)
        styleProfile = analysisResult.styleProfile

        await prisma.brand.update({
          where: { id: campaign.brandId },
          data: { styleProfile: styleProfile as any },
        })
      }

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { progress: 30 },
      })

      // Generate preview content using themes from campaign config
      const contentRequests: ContentGenerationRequest[] = config.themes.map((theme: string) => ({
        brandId: campaign.brandId,
        count: 1,
        theme,
        style: config.style,
      }))

      // Generate preview posts (3 posts)
      const exampleCount = 3
      const previewRequests = contentRequests.slice(0, exampleCount)

      let examplePosts: GeneratedContent[] = []

      for (let i = 0; i < previewRequests.length; i++) {
        const request = previewRequests[i]

        // Update progress
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { progress: 30 + (i + 1) * 20 }, // 30, 50, 70
        })

        if (request) {
          const content = await generateInstagramContent(styleProfile, campaign.brand.name, request)
          examplePosts.push(...content)
        }
      }

      // If we have fewer posts than requested, generate more with the first theme
      while (examplePosts.length < exampleCount && config.themes.length > 0) {
        const additionalContent = await generateInstagramContent(styleProfile, campaign.brand.name, {
          brandId: campaign.brandId,
          count: 1,
          theme: config.themes[0],
          style: config.style,
        })
        examplePosts.push(...additionalContent)
      }

      // Trim to exact count requested
      examplePosts = examplePosts.slice(0, exampleCount)

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { progress: 80 },
      })

      // Check if preview posts already exist for this campaign
      const existingPreviews = await prisma.content.findMany({
        where: {
          campaignId: campaignId,
          scheduledAt: null,
        },
      })

      // Delete existing preview posts to replace them with new ones
      if (existingPreviews.length > 0) {
        await prisma.content.deleteMany({
          where: {
            id: {
              in: existingPreviews.map((p) => p.id),
            },
          },
        })
      }

      // Save new preview posts to database
      for (const post of examplePosts) {
        console.log('Saving post to database:', {
          caption: post.caption?.substring(0, 50) + '...',
          hashtags: post.hashtags?.length || 0,
          imageUrl: post.imageUrl?.substring(0, 80) + '...' || 'Missing',
          imageUrlLength: post.imageUrl?.length || 0,
          s3ImageKey: post.s3ImageKey || 'NOT SET',
          cdnImageUrl: post.cdnImageUrl?.substring(0, 80) + '...' || 'NOT SET',
          hasS3Fields: !!(post.s3ImageKey && post.cdnImageUrl)
        })

        await prisma.content.create({
          data: {
            caption: post.caption,
            hashtags: post.hashtags,
            imageUrl: post.imageUrl ?? null,
            s3ImageKey: post.s3ImageKey ?? null,
            cdnImageUrl: post.cdnImageUrl ?? null,
            imageRegion: post.imageRegion ?? null,
            retentionExpiresAt: post.retentionExpiresAt ?? null,
            brandId: campaign.brandId,
            campaignId: campaign.id,
            status: 'pending', // Preview posts start as pending
            generationParams: {
              theme: config.themes?.[0] || 'preview',
              style: config.style,
              campaignGenerated: true,
              isPreview: true,
            },
          },
        })
      }

      // Mark campaign as ready for preview
      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'preview',
          progress: 100,
          previewGenerated: true,
          errorMessage: null,
        },
      })

      console.log(`Campaign preview generation completed for ${campaignId}`)
    } catch (error) {
      console.error(`Campaign preview generation failed for ${campaignId}:`, error)

      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error occurred',
          progress: 0,
        },
      })
    }
  }

  /**
   * Check if a campaign job is currently running
   */
  isJobRunning(campaignId: string): boolean {
    return this.runningJobs.has(campaignId)
  }

  /**
   * Get current job status
   */
  async getCampaignStatus(campaignId: string): Promise<any> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        status: true,
        progress: true,
        errorMessage: true,
        previewGenerated: true,
      },
    })

    return campaign
  }
}

export const campaignJobService = new CampaignJobService()
