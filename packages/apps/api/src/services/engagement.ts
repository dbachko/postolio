import { Prisma } from '@postolio/database';
import { instagramService } from './instagram.js';
import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

export interface EngagementRules {
  id?: string;
  brandId: string;
  autoLike: {
    enabled: boolean;
    targetHashtags: string[];
    maxLikesPerHour: number;
    likeProbability?: number;
  };
  autoComment: {
    enabled: boolean;
    templates: string[];
    maxCommentsPerHour: number;
    commentProbability?: number;
  };
  autoFollow: {
    enabled: boolean;
    maxFollowsPerHour: number;
    followProbability?: number;
    targetAccounts?: string[];
  };
  autoUnfollow: {
    enabled: boolean;
    maxUnfollowsPerHour: number;
    unfollowAfterDays: number;
  };
  safetyLimits: {
    maxActionsPerHour: number;
    minDelayBetweenActions: number;
    respectBusinessHours: boolean;
  };
}

export interface EngagementAction {
  id: string;
  brandId: string;
  type: 'like' | 'comment' | 'follow' | 'unfollow';
  targetId: string;
  targetType: 'post' | 'user';
  status: 'pending' | 'completed' | 'failed';
  scheduledAt: Date;
  executedAt?: Date;
  metadata?: Record<string, unknown>;
  error?: string;
}

class EngagementService {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  /**
   * Create or update engagement rules for a brand
   */
  async setEngagementRules(rules: EngagementRules): Promise<EngagementRules> {
    try {
      // Validate safety limits
      this.validateRules(rules);

      // Store rules in database as JSON
      const brand = await prisma.brand.update({
        where: { id: rules.brandId },
        data: {
          engagementRules: JSON.parse(JSON.stringify(rules)) as Prisma.InputJsonValue,
        },
      });

      return {
        id: brand.id,
        ...rules,
      };
    } catch (error) {
      console.error('Failed to set engagement rules:', error);
      throw error;
    }
  }

  /**
   * Get engagement rules for a brand
   */
  async getEngagementRules(brandId: string): Promise<EngagementRules | null> {
    try {
      const brand = await prisma.brand.findFirst({
        where: { id: brandId },
      });

      if (!brand || !brand.engagementRules) {
        return null;
      }

      const stored = brand.engagementRules as unknown;
      return {
        id: brand.id,
        ...(stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}),
      } as EngagementRules;
    } catch (error) {
      console.error('Failed to get engagement rules:', error);
      return null;
    }
  }

  /**
   * Validate engagement rules for safety and compliance
   */
  private validateRules(rules: EngagementRules): void {
    // Instagram API rate limits and best practices
    const MAX_LIKES_PER_HOUR = 60;
    const MAX_COMMENTS_PER_HOUR = 20;
    const MAX_FOLLOWS_PER_HOUR = 15;
    const MAX_TOTAL_ACTIONS_PER_HOUR = 80;
    const MIN_DELAY_SECONDS = 30;

    if (rules.autoLike.maxLikesPerHour > MAX_LIKES_PER_HOUR) {
      throw new Error(`Max likes per hour cannot exceed ${MAX_LIKES_PER_HOUR}`);
    }

    if (rules.autoComment.maxCommentsPerHour > MAX_COMMENTS_PER_HOUR) {
      throw new Error(`Max comments per hour cannot exceed ${MAX_COMMENTS_PER_HOUR}`);
    }

    if (rules.autoFollow.maxFollowsPerHour > MAX_FOLLOWS_PER_HOUR) {
      throw new Error(`Max follows per hour cannot exceed ${MAX_FOLLOWS_PER_HOUR}`);
    }

    const totalActions =
      rules.autoLike.maxLikesPerHour +
      rules.autoComment.maxCommentsPerHour +
      rules.autoFollow.maxFollowsPerHour;

    if (totalActions > MAX_TOTAL_ACTIONS_PER_HOUR) {
      throw new Error(`Total actions per hour cannot exceed ${MAX_TOTAL_ACTIONS_PER_HOUR}`);
    }

    if (rules.safetyLimits.minDelayBetweenActions < MIN_DELAY_SECONDS) {
      throw new Error(
        `Minimum delay between actions must be at least ${MIN_DELAY_SECONDS} seconds`
      );
    }

    // Validate comment templates
    if (rules.autoComment.enabled && rules.autoComment.templates.length === 0) {
      throw new Error('Comment templates are required when auto-comment is enabled');
    }

    // Validate hashtags
    if (rules.autoLike.enabled && rules.autoLike.targetHashtags.length === 0) {
      throw new Error('Target hashtags are required when auto-like is enabled');
    }
  }

  /**
   * Start the engagement automation service
   */
  start(): void {
    if (this.isRunning) {
      console.log('Engagement automation is already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting engagement automation service...');

    // Check for engagement actions every 2 minutes
    this.intervalId = setInterval(
      () => {
        this.processEngagementActions();
      },
      2 * 60 * 1000
    );

    // Also run immediately
    this.processEngagementActions();
  }

  /**
   * Stop the engagement automation service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('Engagement automation service stopped');
  }

  /**
   * Process pending engagement actions
   */
  private async processEngagementActions(): Promise<void> {
    try {
      // Get all brands with engagement rules enabled
      const brands = await prisma.brand.findMany({
        where: {
          engagementRules: { not: Prisma.JsonNull },
          instagramAccountId: { not: null },
        },
      });

      for (const brand of brands) {
        await this.processBrandEngagement(brand);
      }
    } catch (error) {
      console.error('Error processing engagement actions:', error);
    }
  }

  /**
   * Process engagement for a specific brand
   */
  private async processBrandEngagement(brand: {
    id: string;
    engagementRules?: unknown;
    instagramAccountId?: string | null;
  }): Promise<void> {
    try {
      const rules = brand.engagementRules as EngagementRules;
      if (!rules) return;

      // Check if we're within business hours if required
      if (rules.safetyLimits.respectBusinessHours && !this.isBusinessHours()) {
        return;
      }

      // Check rate limits for the last hour
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentActions = await this.getRecentActions(brand.id, hourAgo);

      if (recentActions.length >= rules.safetyLimits.maxActionsPerHour) {
        console.log(`Rate limit reached for brand ${brand.id}`);
        return;
      }

      // Check if Instagram service is configured for this brand
      if (!instagramService.isConfigured(brand)) {
        console.log(`Instagram not configured for brand ${brand.id}`);
        return;
      }

      // Process different engagement types
      if (rules.autoLike.enabled) {
        await this.processAutoLikes(brand, rules, recentActions.length);
      }

      if (rules.autoComment.enabled) {
        await this.processAutoComments(brand, rules, recentActions.length);
      }

      if (rules.autoFollow.enabled) {
        await this.processAutoFollows(brand, rules, recentActions.length);
      }
    } catch (error) {
      console.error(`Error processing engagement for brand ${brand.id}:`, error);
    }
  }

  /**
   * Process automatic likes based on hashtags
   */
  private async processAutoLikes(
    brand: { id: string },
    rules: EngagementRules,
    currentActionCount: number
  ): Promise<void> {
    const likesThisHour = currentActionCount; // Simplified for this implementation
    const remainingLikes = rules.autoLike.maxLikesPerHour - likesThisHour;

    if (remainingLikes <= 0) return;

    try {
      // Find posts to like based on target hashtags
      // In a real implementation, you'd search Instagram for recent posts with target hashtags
      // For now, we'll simulate finding posts
      const postsToLike = await this.findPostsByHashtags(
        rules.autoLike.targetHashtags,
        Math.min(remainingLikes, 5)
      );

      for (const post of postsToLike) {
        // Check probability
        const probability = rules.autoLike.likeProbability || 0.3;
        if (Math.random() > probability) continue;

        // Schedule like action
        await this.scheduleEngagementAction({
          brandId: brand.id,
          type: 'like',
          targetId: post.id,
          targetType: 'post',
          scheduledAt: new Date(),
          metadata: { hashtags: post.hashtags },
        });
      }
    } catch (error) {
      console.error('Error processing auto likes:', error);
    }
  }

  /**
   * Process automatic comments
   */
  private async processAutoComments(
    brand: { id: string },
    rules: EngagementRules,
    currentActionCount: number
  ): Promise<void> {
    const commentsThisHour = currentActionCount; // Simplified
    const remainingComments = rules.autoComment.maxCommentsPerHour - commentsThisHour;

    if (remainingComments <= 0) return;

    try {
      const postsToComment = await this.findPostsForComments(Math.min(remainingComments, 3));

      for (const post of postsToComment) {
        const probability = rules.autoComment.commentProbability || 0.1;
        if (Math.random() > probability) continue;

        // Select random comment template
        const template =
          rules.autoComment.templates[
            Math.floor(Math.random() * rules.autoComment.templates.length)
          ];

        await this.scheduleEngagementAction({
          brandId: brand.id,
          type: 'comment',
          targetId: post.id,
          targetType: 'post',
          scheduledAt: new Date(),
          metadata: { comment: template },
        });
      }
    } catch (error) {
      console.error('Error processing auto comments:', error);
    }
  }

  /**
   * Process automatic follows
   */
  private async processAutoFollows(
    brand: { id: string },
    rules: EngagementRules,
    currentActionCount: number
  ): Promise<void> {
    const followsThisHour = currentActionCount; // Simplified
    const remainingFollows = rules.autoFollow.maxFollowsPerHour - followsThisHour;

    if (remainingFollows <= 0) return;

    try {
      const usersToFollow = await this.findUsersToFollow(
        rules.autoFollow.targetAccounts || [],
        Math.min(remainingFollows, 2)
      );

      for (const user of usersToFollow) {
        const probability = rules.autoFollow.followProbability || 0.05;
        if (Math.random() > probability) continue;

        await this.scheduleEngagementAction({
          brandId: brand.id,
          type: 'follow',
          targetId: user.id,
          targetType: 'user',
          scheduledAt: new Date(),
          metadata: { username: user.username },
        });
      }
    } catch (error) {
      console.error('Error processing auto follows:', error);
    }
  }

  /**
   * Schedule an engagement action
   */
  private async scheduleEngagementAction(
    action: Omit<EngagementAction, 'id' | 'status'>
  ): Promise<void> {
    // Store in database (simplified - you'd want a proper engagement_actions table)
    console.log(`Scheduled ${action.type} action for brand ${action.brandId}`);

    // For testing, we'll simulate execution immediately
    await this.executeEngagementAction({
      ...action,
      id: `action_${Date.now()}`,
      status: 'pending',
    });
  }

  /**
   * Execute an engagement action
   */
  private async executeEngagementAction(action: EngagementAction): Promise<void> {
    try {
      console.log(`Executing ${action.type} action: ${action.id}`);

      // In a real implementation, you'd call Instagram API here
      // For testing, we'll just log the action

      await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate API call

      console.log(`Completed ${action.type} action: ${action.id}`);
    } catch (error) {
      console.error(`Failed to execute ${action.type} action:`, error);
    }
  }

  /**
   * Get recent actions for rate limiting
   */
  private async getRecentActions(_brandId: string, _since: Date): Promise<EngagementAction[]> {
    void _brandId;
    void _since;
    // In a real implementation, query engagement_actions table
    // For now, return empty array
    return [];
  }

  /**
   * Check if current time is within business hours
   */
  private isBusinessHours(): boolean {
    const now = new Date();
    const hour = now.getHours();
    // Business hours: 9 AM to 6 PM
    return hour >= 9 && hour <= 18;
  }

  /**
   * Find posts by hashtags (mock implementation)
   */
  private async findPostsByHashtags(
    hashtags: string[],
    limit: number
  ): Promise<Array<{ id: string; hashtags: string[] }>> {
    // Mock implementation - in reality, you'd search Instagram
    return Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
      id: `post_${Date.now()}_${i}`,
      hashtags: hashtags.slice(0, 2),
    }));
  }

  /**
   * Find posts for commenting (mock implementation)
   */
  private async findPostsForComments(limit: number): Promise<Array<{ id: string }>> {
    return Array.from({ length: Math.min(limit, 2) }, (_, i) => ({
      id: `post_comment_${Date.now()}_${i}`,
    }));
  }

  /**
   * Find users to follow (mock implementation)
   */
  private async findUsersToFollow(
    targetAccounts: string[],
    limit: number
  ): Promise<Array<{ id: string; username: string }>> {
    return Array.from({ length: Math.min(limit, 1) }, (_, i) => ({
      id: `user_${Date.now()}_${i}`,
      username: `target_user_${i}`,
    }));
  }

  /**
   * Get engagement statistics for a brand
   */
  async getEngagementStats(
    brandId: string,
    days: number = 7
  ): Promise<{
    totalActions: number;
    likes: number;
    comments: number;
    follows: number;
    successRate: number;
    averageActionsPerDay: number;
  }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // In a real implementation, you'd query the engagement_actions table
    return {
      totalActions: 0,
      likes: 0,
      comments: 0,
      follows: 0,
      successRate: 0,
      averageActionsPerDay: 0,
    };
  }
}

export const engagementService = new EngagementService();
