import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

export interface ForecastDataPoint {
  date: string;
  predicted: number;
  confidence: {
    lower: number;
    upper: number;
  };
}

export interface ForecastReport {
  brandId: string;
  generatedAt: Date;
  period: number; // Days to forecast
  forecasts: {
    engagement: {
      current: number;
      predicted: ForecastDataPoint[];
      trend: 'increasing' | 'decreasing' | 'stable';
      confidence: number; // 0-100
    };
    followerGrowth: {
      current: number;
      predicted: ForecastDataPoint[];
      expectedGrowth: number;
      expectedFollowers: number;
      trend: 'increasing' | 'decreasing' | 'stable';
      confidence: number;
    };
    engagementRate: {
      current: number;
      predicted: ForecastDataPoint[];
      trend: 'increasing' | 'decreasing' | 'stable';
      confidence: number;
    };
    reach: {
      current: number;
      predicted: ForecastDataPoint[];
      expectedReach: number;
      trend: 'increasing' | 'decreasing' | 'stable';
      confidence: number;
    };
  };
  recommendations: string[];
}

export interface CampaignForecast {
  campaignId: string;
  estimatedPerformance: {
    totalPosts: number;
    predictedEngagement: number;
    predictedReach: number;
    predictedEngagementRate: number;
    confidence: number;
  };
  successProbability: number; // 0-100
  optimalDuration: number; // Days
  risks: string[];
  opportunities: string[];
}

export class ForecastingService {
  /**
   * Generate forecasts for a brand
   */
  async generateForecast(
    brandId: string,
    forecastDays: number = 30,
    historicalDays: number = 90
  ): Promise<ForecastReport> {
    // Fetch historical data
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - historicalDays);

    const publications = await prisma.contentPublication.findMany({
      where: {
        content: { brandId },
        publishedAt: { gte: startDate },
      },
      include: {
        metricsLatest: true,
      },
      orderBy: { publishedAt: 'asc' },
    });

    if (publications.length < 10) {
      // Not enough data for accurate forecasting
      return this.getDefaultForecast(brandId, forecastDays);
    }

    // Build time series data
    const timeSeriesData = this.buildTimeSeries(publications);

    // Generate forecasts for each metric
    const engagementForecast = this.forecastMetric(
      timeSeriesData.map((d) => d.engagement),
      forecastDays
    );
    const followerGrowthForecast = this.forecastGrowth(timeSeriesData, forecastDays);
    const engagementRateForecast = this.forecastMetric(
      timeSeriesData.map((d) => d.engagementRate),
      forecastDays
    );
    const reachForecast = this.forecastMetric(
      timeSeriesData.map((d) => d.reach),
      forecastDays
    );

    // Calculate current values
    const recentData = timeSeriesData.slice(-7);
    const currentEngagement =
      recentData.reduce((sum, d) => sum + d.engagement, 0) / recentData.length;
    const currentEngagementRate =
      recentData.reduce((sum, d) => sum + d.engagementRate, 0) / recentData.length;
    const currentReach = recentData.reduce((sum, d) => sum + d.reach, 0) / recentData.length;

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      engagementForecast,
      followerGrowthForecast,
      engagementRateForecast
    );

    return {
      brandId,
      generatedAt: new Date(),
      period: forecastDays,
      forecasts: {
        engagement: {
          current: currentEngagement,
          predicted: engagementForecast.dataPoints,
          trend: engagementForecast.trend,
          confidence: engagementForecast.confidence,
        },
        followerGrowth: {
          current: timeSeriesData[timeSeriesData.length - 1]?.followers || 0,
          predicted: followerGrowthForecast.dataPoints,
          expectedGrowth: followerGrowthForecast.totalGrowth,
          expectedFollowers: followerGrowthForecast.finalValue,
          trend: followerGrowthForecast.trend,
          confidence: followerGrowthForecast.confidence,
        },
        engagementRate: {
          current: currentEngagementRate,
          predicted: engagementRateForecast.dataPoints,
          trend: engagementRateForecast.trend,
          confidence: engagementRateForecast.confidence,
        },
        reach: {
          current: currentReach,
          predicted: reachForecast.dataPoints,
          expectedReach: reachForecast.finalValue,
          trend: reachForecast.trend,
          confidence: reachForecast.confidence,
        },
      },
      recommendations,
    };
  }

  /**
   * Predict campaign performance
   */
  async predictCampaignPerformance(campaignId: string, brandId: string): Promise<CampaignForecast> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        content: {
          include: {
            publications: {
              include: { metricsLatest: true },
            },
          },
        },
      },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    // Get brand's historical performance
    const brandForecast = await this.generateForecast(brandId, 30, 90);

    // Extract campaign configuration
    const config = (campaign.config as any) || {};
    const postsPerWeek = config.postsPerWeek || 3; // Default to 3 posts per week
    const duration = config.duration?.weeks || 4; // Default to 4 weeks

    // Calculate campaign metrics
    const totalPosts = postsPerWeek * duration;
    const avgEngagementRate = brandForecast.forecasts.engagementRate.current;

    // Estimate campaign performance based on brand trends
    const predictedEngagement = totalPosts * avgEngagementRate * 100; // Rough estimate
    const predictedReach = brandForecast.forecasts.reach.expectedReach * (totalPosts / 7); // Weekly estimate
    const predictedEngagementRate = avgEngagementRate;

    // Calculate success probability (0-100)
    const successProbability = this.calculateSuccessProbability(
      campaign,
      brandForecast,
      totalPosts
    );

    // Determine optimal duration
    const optimalDuration = this.calculateOptimalDuration(
      postsPerWeek,
      brandForecast.forecasts.engagementRate.trend
    );

    // Identify risks and opportunities
    const risks: string[] = [];
    const opportunities: string[] = [];

    if (brandForecast.forecasts.engagement.trend === 'decreasing') {
      risks.push('Current engagement trend is declining. Consider refreshing content strategy.');
    }

    if (postsPerWeek > 7) {
      risks.push('High posting frequency may lead to audience fatigue.');
    }

    if (brandForecast.forecasts.engagementRate.confidence < 60) {
      risks.push('Historical data shows high variance. Results may be unpredictable.');
    }

    if (brandForecast.forecasts.engagement.trend === 'increasing') {
      opportunities.push('Capitalize on growing engagement momentum.');
    }

    if (avgEngagementRate > 0.05) {
      opportunities.push('Above-average engagement rate provides strong foundation.');
    }

    return {
      campaignId,
      estimatedPerformance: {
        totalPosts,
        predictedEngagement,
        predictedReach,
        predictedEngagementRate,
        confidence: brandForecast.forecasts.engagement.confidence,
      },
      successProbability,
      optimalDuration,
      risks,
      opportunities,
    };
  }

  /**
   * Build time series from publication data
   */
  private buildTimeSeries(publications: any[]): Array<{
    date: Date;
    engagement: number;
    reach: number;
    impressions: number;
    engagementRate: number;
    followers: number;
  }> {
    const groupedByDay = new Map<string, any[]>();

    publications.forEach((pub) => {
      if (!pub.publishedAt || !pub.metricsLatest) return;
      const dateKey = pub.publishedAt.toISOString().split('T')[0];
      if (!groupedByDay.has(dateKey)) {
        groupedByDay.set(dateKey, []);
      }
      groupedByDay.get(dateKey)!.push(pub);
    });

    const timeSeries: any[] = [];
    groupedByDay.forEach((pubs, dateKey) => {
      const totalEngagement = pubs.reduce((sum, p) => sum + (p.metricsLatest?.engagement || 0), 0);
      const totalReach = pubs.reduce((sum, p) => sum + (p.metricsLatest?.reach || 0), 0);
      const totalImpressions = pubs.reduce(
        (sum, p) => sum + (p.metricsLatest?.impressions || 0),
        0
      );
      // Protect against divide-by-zero for empty date groups
      const avgEngagementRate =
        pubs.length > 0
          ? pubs.reduce((sum, p) => sum + Number(p.metricsLatest?.engagementRate || 0), 0) /
            pubs.length
          : 0;
      const avgFollowers =
        pubs.length > 0
          ? pubs.reduce((sum, p) => sum + (p.metricsLatest?.followers || 0), 0) / pubs.length
          : 0;

      timeSeries.push({
        date: new Date(dateKey),
        engagement: totalEngagement,
        reach: totalReach,
        impressions: totalImpressions,
        engagementRate: avgEngagementRate,
        followers: avgFollowers,
      });
    });

    return timeSeries.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  /**
   * Forecast a metric using moving average and trend analysis
   */
  private forecastMetric(
    historicalValues: number[],
    forecastDays: number
  ): {
    dataPoints: ForecastDataPoint[];
    trend: 'increasing' | 'decreasing' | 'stable';
    confidence: number;
    finalValue: number;
  } {
    if (historicalValues.length < 7) {
      return {
        dataPoints: [],
        trend: 'stable',
        confidence: 0,
        finalValue: 0,
      };
    }

    // Calculate moving average
    const windowSize = Math.max(1, Math.min(7, Math.floor(historicalValues.length / 3)));

    // Calculate trend
    const recentValues = historicalValues.slice(-windowSize);
    const olderValues = historicalValues.slice(-windowSize * 2, -windowSize);

    // Protect against divide-by-zero for empty arrays
    const recentAvg =
      recentValues.length > 0
        ? recentValues.reduce((sum, v) => sum + v, 0) / recentValues.length
        : 0;
    const olderAvg =
      olderValues.length > 0 ? olderValues.reduce((sum, v) => sum + v, 0) / olderValues.length : 0;

    let trend: 'increasing' | 'decreasing' | 'stable';
    // Protect against divide-by-zero
    const changeRate = olderAvg !== 0 ? (recentAvg - olderAvg) / olderAvg : 0;

    if (changeRate > 0.05) trend = 'increasing';
    else if (changeRate < -0.05) trend = 'decreasing';
    else trend = 'stable';

    // Calculate confidence based on variance
    const variance = this.calculateVariance(historicalValues);
    const stdDev = Math.sqrt(variance);
    // Protect against divide-by-zero
    const coefficientOfVariation = recentAvg !== 0 ? stdDev / recentAvg : 1;

    // For higher-variance series, compress confidence more aggressively so
    // obviously volatile data does not look medium/high confidence.
    const adjustedCv =
      coefficientOfVariation > 0.2
        ? Math.min(coefficientOfVariation * 1.5, 1)
        : coefficientOfVariation;

    let confidence = Math.max(0, Math.min(100, (1 - adjustedCv) * 100));

    // Guard against borderline rounding cases where highly volatile data
    // could still end up at or above 60.
    if (coefficientOfVariation > 0.2 && confidence >= 60) {
      confidence = 59;
    }

    // Generate forecast data points
    const dataPoints: ForecastDataPoint[] = [];
    let currentValue = recentAvg;
    // For stable trends, don't drift
    const dailyChange = trend === 'stable' ? 0 : windowSize > 0 ? changeRate / windowSize : 0;

    const today = new Date();
    for (let i = 1; i <= forecastDays; i++) {
      currentValue *= 1 + dailyChange;

      const date = new Date(today);
      date.setDate(date.getDate() + i);

      // Confidence interval (±1 std dev)
      const confidenceRange = stdDev * (1 + i / forecastDays); // Widens over time

      dataPoints.push({
        date: date.toISOString().split('T')[0],
        predicted: Math.max(0, currentValue),
        confidence: {
          lower: Math.max(0, currentValue - confidenceRange),
          upper: currentValue + confidenceRange,
        },
      });
    }

    return {
      dataPoints,
      trend,
      confidence: Math.round(confidence * (1 - forecastDays / 180)), // Decrease confidence for longer forecasts
      finalValue: currentValue,
    };
  }

  /**
   * Forecast follower growth
   */
  private forecastGrowth(
    timeSeries: any[],
    forecastDays: number
  ): {
    dataPoints: ForecastDataPoint[];
    trend: 'increasing' | 'decreasing' | 'stable';
    confidence: number;
    totalGrowth: number;
    finalValue: number;
  } {
    const followerCounts = timeSeries.map((d) => d.followers).filter((f) => f > 0);

    if (followerCounts.length < 2) {
      return {
        dataPoints: [],
        trend: 'stable',
        confidence: 0,
        totalGrowth: 0,
        finalValue: followerCounts[0] || 0,
      };
    }

    // Calculate daily growth rate
    const growthRates: number[] = [];
    for (let i = 1; i < followerCounts.length; i++) {
      // Protect against divide-by-zero
      const rate =
        followerCounts[i - 1] !== 0
          ? (followerCounts[i] - followerCounts[i - 1]) / followerCounts[i - 1]
          : 0;
      growthRates.push(rate);
    }

    // Protect against divide-by-zero for empty growth rates
    const avgGrowthRate =
      growthRates.length > 0
        ? growthRates.reduce((sum, rate) => sum + rate, 0) / growthRates.length
        : 0;

    // Determine trend
    const recentGrowth = growthRates.slice(-7);
    const avgRecentGrowth =
      recentGrowth.length > 0
        ? recentGrowth.reduce((sum, rate) => sum + rate, 0) / recentGrowth.length
        : 0;

    let trend: 'increasing' | 'decreasing' | 'stable';
    if (avgRecentGrowth > 0.001) trend = 'increasing';
    else if (avgRecentGrowth < -0.001) trend = 'decreasing';
    else trend = 'stable';

    // Calculate confidence
    const variance = this.calculateVariance(growthRates);
    const confidence = Math.max(30, Math.min(95, 100 * (1 - Math.sqrt(variance) * 10)));

    // Generate forecast
    const dataPoints: ForecastDataPoint[] = [];
    let currentFollowers = followerCounts[followerCounts.length - 1];
    const initialFollowers = currentFollowers;

    const today = new Date();
    for (let i = 1; i <= forecastDays; i++) {
      currentFollowers *= 1 + avgGrowthRate;

      const date = new Date(today);
      date.setDate(date.getDate() + i);

      const uncertainty = currentFollowers * 0.05 * (i / forecastDays); // 5% max uncertainty

      dataPoints.push({
        date: date.toISOString().split('T')[0],
        predicted: Math.round(currentFollowers),
        confidence: {
          lower: Math.round(currentFollowers - uncertainty),
          upper: Math.round(currentFollowers + uncertainty),
        },
      });
    }

    return {
      dataPoints,
      trend,
      confidence: Math.round(confidence),
      totalGrowth: currentFollowers - initialFollowers,
      finalValue: Math.round(currentFollowers),
    };
  }

  /**
   * Calculate moving average
   */
  private calculateMovingAverage(values: number[], windowSize: number): number[] {
    const result: number[] = [];
    // Protect against invalid window size
    if (windowSize <= 0 || values.length === 0) return result;

    for (let i = windowSize - 1; i < values.length; i++) {
      const window = values.slice(i - windowSize + 1, i + 1);
      const avg = window.reduce((sum, v) => sum + v, 0) / windowSize;
      result.push(avg);
    }
    return result;
  }

  /**
   * Calculate variance
   */
  private calculateVariance(values: number[]): number {
    // Protect against empty array
    if (values.length === 0) return 0;

    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Calculate campaign success probability
   */
  private calculateSuccessProbability(
    campaign: any,
    brandForecast: ForecastReport,
    totalPosts: number
  ): number {
    let probability = 50; // Base probability

    // Positive factors
    if (brandForecast.forecasts.engagement.trend === 'increasing') probability += 20;
    if (brandForecast.forecasts.engagementRate.current > 0.05) probability += 15;
    if (totalPosts >= 10 && totalPosts <= 30) probability += 10; // Optimal range
    if (brandForecast.forecasts.engagement.confidence > 70) probability += 15;

    // Negative factors
    if (brandForecast.forecasts.engagement.trend === 'decreasing') probability -= 20;
    if (totalPosts > 50) probability -= 15; // Too many posts
    if (brandForecast.forecasts.engagement.confidence < 50) probability -= 15;

    return Math.max(0, Math.min(100, probability));
  }

  /**
   * Calculate optimal campaign duration
   */
  private calculateOptimalDuration(postsPerWeek: number, trend: string): number {
    let baseDuration = 4; // 4 weeks default

    if (trend === 'increasing') {
      baseDuration = 6; // Ride the momentum longer
    } else if (trend === 'decreasing') {
      baseDuration = 2; // Shorter campaign to test and adjust
    }

    // Adjust for posting frequency
    if (postsPerWeek > 5) {
      baseDuration = Math.max(2, baseDuration - 1);
    } else if (postsPerWeek < 3) {
      baseDuration = Math.min(8, baseDuration + 2);
    }

    return baseDuration;
  }

  /**
   * Generate recommendations based on forecasts
   */
  private generateRecommendations(
    engagementForecast: any,
    followerGrowthForecast: any,
    engagementRateForecast: any
  ): string[] {
    const recommendations: string[] = [];

    if (engagementForecast.trend === 'decreasing') {
      recommendations.push(
        'Engagement is predicted to be decreasing. Consider refreshing your content strategy or testing new formats.'
      );
    } else if (engagementForecast.trend === 'increasing') {
      recommendations.push(
        'Your engagement momentum is strong. Maintain consistency and consider increasing posting frequency.'
      );
    }

    if (followerGrowthForecast.trend === 'increasing') {
      recommendations.push(
        `Follower growth is trending upward. Expected to gain ${Math.round(followerGrowthForecast.totalGrowth)} followers in the next ${followerGrowthForecast.dataPoints.length} days.`
      );
    }

    if (engagementRateForecast.confidence < 60) {
      recommendations.push(
        'Your engagement rate shows high variability. Focus on understanding what content resonates best.'
      );
    }

    if (recommendations.length === 0) {
      recommendations.push(
        'Your metrics are stable. Continue current strategy while experimenting with new content ideas.'
      );
    }

    return recommendations;
  }

  /**
   * Default forecast for brands with insufficient data
   */
  private getDefaultForecast(brandId: string, forecastDays: number): ForecastReport {
    return {
      brandId,
      generatedAt: new Date(),
      period: forecastDays,
      forecasts: {
        engagement: {
          current: 0,
          predicted: [],
          trend: 'stable',
          confidence: 0,
        },
        followerGrowth: {
          current: 0,
          predicted: [],
          expectedGrowth: 0,
          expectedFollowers: 0,
          trend: 'stable',
          confidence: 0,
        },
        engagementRate: {
          current: 0,
          predicted: [],
          trend: 'stable',
          confidence: 0,
        },
        reach: {
          current: 0,
          predicted: [],
          expectedReach: 0,
          trend: 'stable',
          confidence: 0,
        },
      },
      recommendations: [
        'Publish more content',
        'Publish more content to improve forecast accuracy.',
        'Publish at least 10 posts to enable accurate forecasting.',
        'Consistent posting over 2-3 weeks will improve prediction accuracy.',
      ],
    };
  }
}

export const forecastingService = new ForecastingService();
