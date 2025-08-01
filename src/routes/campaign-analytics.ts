import { FastifyRequest, FastifyReply } from 'fastify'
import { campaignAnalyticsService } from '../services/campaign-analytics.js'

interface CampaignMetricsRequest extends FastifyRequest {
  params: {
    campaignId: string
  }
  query: {
    timeRange?: '7d' | '30d' | '90d'
  }
}

interface CompareCampaignsRequest extends FastifyRequest {
  body: {
    campaignIds: string[]
  }
}

interface OptimizationRequest extends FastifyRequest {
  params: {
    campaignId: string
  }
}

interface ROIRequest extends FastifyRequest {
  params: {
    campaignId: string
  }
}

export async function campaignAnalyticsRoutes(fastify: any) {
  // Get campaign performance metrics
  fastify.get('/campaign/analytics/:campaignId', {
    preHandler: [fastify.authenticate]
  }, async (request: CampaignMetricsRequest, reply: FastifyReply) => {
    try {
      const { campaignId } = request.params
      const userId = request.user.userId
      
      const metrics = await campaignAnalyticsService.getCampaignMetrics(campaignId, userId)
      
      reply.send({
        success: true,
        data: metrics,
        lastUpdated: new Date().toISOString(),
        fromCache: false
      })
    } catch (error) {
      console.error('Get campaign metrics error:', error)
      reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get campaign metrics'
      })
    }
  })

  // Compare multiple campaigns
  fastify.post('/campaign/analytics/compare', {
    preHandler: [fastify.authenticate]
  }, async (request: CompareCampaignsRequest, reply: FastifyReply) => {
    try {
      const { campaignIds } = request.body
      const userId = request.user.userId

      if (!Array.isArray(campaignIds) || campaignIds.length === 0) {
        reply.status(400).send({
          success: false,
          error: 'campaignIds array is required and cannot be empty'
        })
        return
      }

      if (campaignIds.length > 10) {
        reply.status(400).send({
          success: false,
          error: 'Cannot compare more than 10 campaigns at once'
        })
        return
      }

      const comparison = await campaignAnalyticsService.compareCampaigns(campaignIds, userId)
      
      reply.send({
        success: true,
        data: comparison,
        lastUpdated: new Date().toISOString()
      })
    } catch (error) {
      console.error('Compare campaigns error:', error)
      reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to compare campaigns'
      })
    }
  })

  // Get optimization recommendations
  fastify.get('/campaign/analytics/:campaignId/recommendations', {
    preHandler: [fastify.authenticate]
  }, async (request: OptimizationRequest, reply: FastifyReply) => {
    try {
      const { campaignId } = request.params
      const userId = request.user.userId
      
      const recommendations = await campaignAnalyticsService.getOptimizationRecommendations(campaignId, userId)
      
      reply.send({
        success: true,
        data: recommendations,
        count: recommendations.length,
        lastUpdated: new Date().toISOString()
      })
    } catch (error) {
      console.error('Get optimization recommendations error:', error)
      reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get optimization recommendations'
      })
    }
  })

  // Calculate campaign ROI
  fastify.get('/campaign/analytics/:campaignId/roi', {
    preHandler: [fastify.authenticate]
  }, async (request: ROIRequest, reply: FastifyReply) => {
    try {
      const { campaignId } = request.params
      const userId = request.user.userId
      
      const roi = await campaignAnalyticsService.calculateROI(campaignId, userId)
      
      reply.send({
        success: true,
        data: roi,
        lastUpdated: new Date().toISOString()
      })
    } catch (error) {
      console.error('Calculate ROI error:', error)
      reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to calculate ROI'
      })
    }
  })

  // Get analytics summary for all campaigns of a brand
  fastify.get('/brand/:brandId/analytics/summary', {
    preHandler: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { brandId: string } }>, reply: FastifyReply) => {
    try {
      const { brandId } = request.params
      const userId = request.user.userId
      
      // Get all campaigns for the brand
      const { PrismaClient } = await import('@prisma/client')
      const prisma = new PrismaClient()
      
      const campaigns = await prisma.campaign.findMany({
        where: {
          brandId,
          brand: { userId },
          status: { in: ['active', 'completed'] }
        },
        select: { id: true, name: true, status: true }
      })

      if (campaigns.length === 0) {
        reply.send({
          success: true,
          data: {
            totalCampaigns: 0,
            summary: {
              totalPosts: 0,
              totalImpressions: 0,
              totalEngagement: 0,
              averageEngagementRate: 0
            },
            topPerformingCampaign: null
          }
        })
        return
      }

      // Get metrics for all campaigns
      const campaignMetrics = []
      let bestPerformingCampaign = null
      let bestEngagementRate = 0

      for (const campaign of campaigns) {
        try {
          const metrics = await campaignAnalyticsService.getCampaignMetrics(campaign.id, userId)
          campaignMetrics.push({
            campaignId: campaign.id,
            campaignName: campaign.name,
            metrics
          })

          if (metrics.averageEngagementRate > bestEngagementRate) {
            bestEngagementRate = metrics.averageEngagementRate
            bestPerformingCampaign = {
              id: campaign.id,
              name: campaign.name,
              engagementRate: metrics.averageEngagementRate
            }
          }
        } catch (error) {
          console.warn(`Failed to get metrics for campaign ${campaign.id}:`, error)
        }
      }

      // Calculate summary
      const summary = campaignMetrics.reduce((acc, { metrics }) => ({
        totalPosts: acc.totalPosts + metrics.totalPosts,
        totalImpressions: acc.totalImpressions + metrics.totalImpressions,
        totalEngagement: acc.totalEngagement + metrics.totalEngagement,
        averageEngagementRate: acc.averageEngagementRate + metrics.averageEngagementRate
      }), {
        totalPosts: 0,
        totalImpressions: 0,
        totalEngagement: 0,
        averageEngagementRate: 0
      })

      summary.averageEngagementRate = campaignMetrics.length > 0 
        ? summary.averageEngagementRate / campaignMetrics.length 
        : 0

      reply.send({
        success: true,
        data: {
          totalCampaigns: campaigns.length,
          summary,
          topPerformingCampaign: bestPerformingCampaign,
          campaignBreakdown: campaignMetrics
        },
        lastUpdated: new Date().toISOString()
      })
    } catch (error) {
      console.error('Get brand analytics summary error:', error)
      reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get brand analytics summary'
      })
    }
  })
}