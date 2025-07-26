import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface GrowthOpportunity {
  type: 'content' | 'engagement' | 'hashtags' | 'timing' | 'collaboration'
  title: string
  description: string
  impact: 'low' | 'medium' | 'high'
  effort: 'low' | 'medium' | 'high'
  priority: number
}

interface GrowthStrategy {
  id: string
  title: string
  description: string
  category: string
  actions: string[]
  timeframe: string
  expectedImpact: string
  resources: string[]
}

interface GrowthMetrics {
  growthRate: number
  reach: number
  engagement: number
  followerTrend: number[]
  engagementTrend: number[]
  reachTrend: number[]
  period: number
}

interface GrowthAnalysis {
  score: number
  opportunities: GrowthOpportunity[]
  recommendations: string[]
  nextActions: string[]
}

export class GrowthService {
  async analyzeGrowthOpportunities(brandId: string): Promise<GrowthAnalysis> {
    // Get brand data and recent performance
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      include: {
        content: {
          orderBy: { createdAt: 'desc' },
          take: 30
        }
      }
    })

    if (!brand) {
      throw new Error('Brand not found')
    }

    // Analyze content performance
    const opportunities = this.identifyOpportunities(brand)
    const score = this.calculateGrowthScore(brand, opportunities)
    const recommendations = this.generateRecommendations(opportunities)
    const nextActions = this.prioritizeActions(opportunities)

    return {
      score,
      opportunities,
      recommendations,
      nextActions
    }
  }

  async generateGrowthStrategies(brandId: string, focus?: string): Promise<GrowthStrategy[]> {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId }
    })

    if (!brand) {
      throw new Error('Brand not found')
    }

    const strategies: GrowthStrategy[] = []

    // Content-focused strategies
    if (!focus || focus === 'content') {
      strategies.push({
        id: 'content-diversification',
        title: 'Content Diversification Strategy',
        description: 'Expand content types to reach new audiences and increase engagement',
        category: 'Content',
        actions: [
          'Create video content (Reels, Stories)',
          'Develop carousel posts with educational content',
          'Share behind-the-scenes content',
          'Post user-generated content campaigns',
          'Create interactive polls and Q&A sessions'
        ],
        timeframe: '3-6 months',
        expectedImpact: '25-40% increase in engagement',
        resources: ['Video editing tools', 'Content calendar', 'Analytics tracking']
      })
    }

    // Engagement-focused strategies
    if (!focus || focus === 'engagement') {
      strategies.push({
        id: 'community-building',
        title: 'Community Building & Engagement',
        description: 'Build a loyal community through active engagement and relationship building',
        category: 'Engagement',
        actions: [
          'Respond to all comments within 2 hours',
          'Create Instagram Stories with polls and questions',
          'Host live Q&A sessions weekly',
          'Collaborate with followers for content creation',
          'Create branded hashtag campaigns'
        ],
        timeframe: '2-4 months',
        expectedImpact: '30-50% increase in community engagement',
        resources: ['Community management tools', 'Engagement tracking', 'Live streaming setup']
      })
    }

    // Growth-focused strategies
    if (!focus || focus === 'growth') {
      strategies.push({
        id: 'strategic-partnerships',
        title: 'Strategic Partnerships & Collaborations',
        description: 'Leverage partnerships to expand reach and tap into new audiences',
        category: 'Growth',
        actions: [
          'Identify complementary brands for collaboration',
          'Partner with micro-influencers in your niche',
          'Guest post on other accounts',
          'Cross-promote with industry partners',
          'Join relevant Instagram pod communities'
        ],
        timeframe: '4-8 months',
        expectedImpact: '50-100% increase in follower growth',
        resources: ['Partnership outreach templates', 'Influencer database', 'Collaboration guidelines']
      })
    }

    return strategies
  }

  async getGrowthMetrics(brandId: string, period: number = 30): Promise<GrowthMetrics> {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      include: {
        content: {
          where: {
            createdAt: {
              gte: new Date(Date.now() - period * 24 * 60 * 60 * 1000)
            }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    })

    if (!brand) {
      throw new Error('Brand not found')
    }

    // Calculate growth metrics
    const growthRate = this.calculateGrowthRate(brand.content, period)
    const reach = this.calculateReach(brand.content)
    const engagement = this.calculateEngagementRate(brand.content)
    
    // Generate trend data
    const followerTrend = this.generateTrendData(period, 'followers')
    const engagementTrend = this.generateTrendData(period, 'engagement')
    const reachTrend = this.generateTrendData(period, 'reach')

    return {
      growthRate,
      reach,
      engagement,
      followerTrend,
      engagementTrend,
      reachTrend,
      period
    }
  }

  private identifyOpportunities(brand: any): GrowthOpportunity[] {
    const opportunities: GrowthOpportunity[] = []

    // Content opportunities
    if (brand.content.length < 10) {
      opportunities.push({
        type: 'content',
        title: 'Increase Content Frequency',
        description: 'Post more consistently to maintain audience engagement',
        impact: 'high',
        effort: 'medium',
        priority: 90
      })
    }

    // Engagement opportunities
    opportunities.push({
      type: 'engagement',
      title: 'Optimize Posting Times',
      description: 'Analyze audience activity to post when followers are most active',
      impact: 'medium',
      effort: 'low',
      priority: 75
    })

    // Hashtag opportunities
    opportunities.push({
      type: 'hashtags',
      title: 'Hashtag Strategy Optimization',
      description: 'Research and use trending, niche-specific hashtags',
      impact: 'medium',
      effort: 'low',
      priority: 70
    })

    // Collaboration opportunities
    opportunities.push({
      type: 'collaboration',
      title: 'Influencer Partnerships',
      description: 'Partner with micro-influencers in your industry',
      impact: 'high',
      effort: 'high',
      priority: 85
    })

    return opportunities.sort((a, b) => b.priority - a.priority)
  }

  private calculateGrowthScore(brand: any, opportunities: GrowthOpportunity[]): number {
    let score = 50 // Base score

    // Content consistency bonus
    if (brand.content.length > 20) score += 20
    else if (brand.content.length > 10) score += 10

    // Opportunity impact
    const highImpactOpportunities = opportunities.filter(o => o.impact === 'high').length
    score += highImpactOpportunities * 5

    return Math.min(100, Math.max(0, score))
  }

  private generateRecommendations(opportunities: GrowthOpportunity[]): string[] {
    return opportunities.slice(0, 3).map(opp => 
      `${opp.title}: ${opp.description}`
    )
  }

  private prioritizeActions(opportunities: GrowthOpportunity[]): string[] {
    return opportunities
      .filter(opp => opp.effort === 'low' || opp.impact === 'high')
      .slice(0, 5)
      .map(opp => opp.title)
  }

  private calculateGrowthRate(content: any[], period: number): number {
    if (content.length === 0) return 0
    
    // Simulate growth rate based on content activity
    const contentPerDay = content.length / period
    return Math.round((contentPerDay * 2.5 + Math.random() * 5) * 100) / 100
  }

  private calculateReach(content: any[]): number {
    // Simulate reach based on content count
    return Math.round((content.length * 150 + Math.random() * 500) * 100) / 100
  }

  private calculateEngagementRate(content: any[]): number {
    // Simulate engagement rate
    return Math.round((3.5 + Math.random() * 2) * 100) / 100
  }

  private generateTrendData(period: number, type: string): number[] {
    const data: number[] = []
    let baseValue = type === 'followers' ? 1000 : type === 'engagement' ? 3.5 : 2000
    
    for (let i = 0; i < Math.min(period, 30); i++) {
      baseValue += (Math.random() - 0.4) * (baseValue * 0.02)
      data.push(Math.round(baseValue * 100) / 100)
    }
    
    return data
  }
}

export default new GrowthService()