import type { StyleProfile } from './ai.js';
import { logger as baseLogger } from '@postolio/logger';
import { getOpenAIClient } from './openai-client.js';
import { getDatabaseClient } from '../config/database.js';
import { formatError } from '../utils/logging.js';
import { applyLearningToStyleProfile as applyLearningToStyleProfileForBrand } from './learning-profile-updater.js';

const prisma = getDatabaseClient();
const learningLogger = baseLogger.child({ module: 'learning-service' });

export interface EditAnalysis {
  captionChanges: {
    lengthChange: number;
    toneChange: 'more_casual' | 'more_formal' | 'no_change';
    emojiChange: 'added' | 'removed' | 'no_change';
    callToActionChange: 'added' | 'removed' | 'modified' | 'no_change';
    personalityShift: string[];
  };
  hashtagChanges: {
    countChange: number;
    addedCategories: string[];
    removedCategories: string[];
    popularityShift: 'more_popular' | 'more_niche' | 'no_change';
  };
  imageChanges: {
    urlChanged: boolean;
    styleDirection?: string;
  };
  timingChanges: {
    timeShift: number; // hours difference
    dayShift: number; // days difference
    schedulingPattern: string;
  };
}

export interface LearningInsight {
  pattern: string;
  confidence: number;
  category: 'caption_style' | 'hashtag_preference' | 'image_style' | 'timing_preference';
  recommendation: string;
  appliedToFuturePosts: number;
}

export interface StyleProfileUpdate {
  field: keyof StyleProfile;
  oldValue: StyleProfile[keyof StyleProfile] | undefined;
  newValue: StyleProfile[keyof StyleProfile];
  confidence: number;
  reasoning: string;
}

export class AILearningService {
  /**
   * Analyze user edits and extract learning patterns
   */
  async analyzeUserEdit(
    _brandId: string,
    originalContent: {
      caption: string;
      imageUrl?: string;
      scheduledAt?: string;
    },
    editedContent: {
      caption: string;
      imageUrl?: string;
      scheduledAt?: string;
    }
  ): Promise<EditAnalysis> {
    learningLogger.info('Analyzing user edit for learning patterns...');

    const analysis: EditAnalysis = {
      captionChanges: await this.analyzeCaptionChanges(
        originalContent.caption,
        editedContent.caption
      ),
      hashtagChanges: {
        countChange: 0,
        addedCategories: [],
        removedCategories: [],
        popularityShift: 'no_change',
      },
      imageChanges: this.analyzeImageChanges(originalContent.imageUrl, editedContent.imageUrl),
      timingChanges: this.analyzeTimingChanges(
        originalContent.scheduledAt,
        editedContent.scheduledAt
      ),
    };

    learningLogger.info('Edit analysis completed', { analysis });
    return analysis;
  }

  /**
   * Apply learning insights to update brand style profile
   */
  async applyLearningToStyleProfile(
    brandId: string,
    editAnalysis: EditAnalysis
  ): Promise<{
    insights: LearningInsight[];
    profileUpdates: StyleProfileUpdate[];
    appliedToFuturePosts: number;
  }> {
    return applyLearningToStyleProfileForBrand(brandId, editAnalysis);
  }

  /**
   * Get learning analytics for a brand
   */
  async getLearningAnalytics(brandId: string): Promise<{
    totalEditsAnalyzed: number;
    profileUpdatesCount: number;
    learningConfidence: number;
    topInsights: Array<{
      category: string;
      pattern: string;
      frequency: number;
      lastDetected: Date;
    }>;
    improvementMetrics: {
      editFrequencyReduction: number;
      contentAcceptanceRate: number;
      styleBoundaryRefinement: number;
    };
  }> {
    // This would typically store learning history in a separate table
    // For now, we'll provide simulated analytics based on current profile
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      include: { content: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });

    if (!brand) {
      throw new Error('Brand not found');
    }

    const totalContent = brand.content.length;

    return {
      totalEditsAnalyzed: Math.floor(totalContent * 0.3), // Simulate 30% edit rate
      profileUpdatesCount: Math.floor(totalContent * 0.1), // Simulate 10% of edits leading to updates
      learningConfidence: Math.min(0.95, 0.5 + totalContent * 0.02), // Increases with content volume
      topInsights: [
        {
          category: 'Tone Preferences',
          pattern: 'User prefers more conversational tone',
          frequency: Math.floor(totalContent * 0.4),
          lastDetected: new Date(),
        },
        {
          category: 'Hashtag Strategy',
          pattern: 'Favors niche-specific hashtags over popular ones',
          frequency: Math.floor(totalContent * 0.6),
          lastDetected: new Date(),
        },
      ],
      improvementMetrics: {
        editFrequencyReduction: Math.min(0.5, totalContent * 0.01), // Fewer edits needed over time
        contentAcceptanceRate: Math.min(0.95, 0.7 + totalContent * 0.01), // Higher acceptance rate
        styleBoundaryRefinement: Math.min(0.9, 0.6 + totalContent * 0.015), // Better style understanding
      },
    };
  }

  /**
   * Analyze changes in caption style and tone
   */
  private async analyzeCaptionChanges(
    original: string,
    edited: string
  ): Promise<EditAnalysis['captionChanges']> {
    if (original === edited) {
      return {
        lengthChange: 0,
        toneChange: 'no_change',
        emojiChange: 'no_change',
        callToActionChange: 'no_change',
        personalityShift: [],
      };
    }

    const lengthChange = edited.length - original.length;

    // Use AI to analyze tone and style changes
    const fallback: EditAnalysis['captionChanges'] = {
      lengthChange,
      toneChange: 'no_change',
      emojiChange: 'no_change',
      callToActionChange: 'no_change',
      personalityShift: [],
    };

    const openai = getOpenAIClient();
    if (!openai) {
      learningLogger.warn('OpenAI client is not configured. Using default caption analysis.');
      return fallback;
    }

    try {
      const prompt = `Analyze the changes between these two Instagram captions:

ORIGINAL: "${original}"
EDITED: "${edited}"

Return a JSON object with:
- toneChange: "more_casual" | "more_formal" | "no_change"
- emojiChange: "added" | "removed" | "no_change"
- callToActionChange: "added" | "removed" | "modified" | "no_change"
- personalityShift: array of personality traits that became more prominent (e.g., ["playful", "professional", "authentic"])

Focus on significant changes only. Return only JSON.`;

      const response = await openai.chat.completions.create({
        model: (await import('./openai-client.js')).getDefaultOpenAIModel(),
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 300,
      });

      const analysis = JSON.parse(response.choices[0]?.message?.content || '{}');

      return {
        lengthChange,
        toneChange: analysis.toneChange || 'no_change',
        emojiChange: analysis.emojiChange || 'no_change',
        callToActionChange: analysis.callToActionChange || 'no_change',
        personalityShift: analysis.personalityShift || [],
      };
    } catch (error) {
      learningLogger.error('Caption analysis error', formatError(error));
      return fallback;
    }
  }

  /**
   * Analyze hashtag preference changes
   */
  private async analyzeHashtagChanges(
    original: string[],
    edited: string[]
  ): Promise<EditAnalysis['hashtagChanges']> {
    const countChange = edited.length - original.length;
    void original;
    // Hashtag-based learning is currently disabled; return neutral changes.
    return {
      countChange,
      addedCategories: [],
      removedCategories: [],
      popularityShift: 'no_change',
    };
  }

  /**
   * Analyze image changes
   */
  private analyzeImageChanges(
    originalUrl?: string,
    editedUrl?: string
  ): EditAnalysis['imageChanges'] {
    const urlChanged = originalUrl !== editedUrl;

    const changes: EditAnalysis['imageChanges'] = {
      urlChanged,
    };

    if (urlChanged) {
      changes.styleDirection = 'user_preference_detected';
    }

    return changes;
  }

  /**
   * Analyze timing preference changes
   */
  private analyzeTimingChanges(
    originalScheduled?: string,
    editedScheduled?: string
  ): EditAnalysis['timingChanges'] {
    if (!originalScheduled || !editedScheduled) {
      return {
        timeShift: 0,
        dayShift: 0,
        schedulingPattern: 'no_change',
      };
    }

    const originalDate = new Date(originalScheduled);
    const editedDate = new Date(editedScheduled);

    const timeShift = editedDate.getHours() - originalDate.getHours();
    const dayShift = Math.floor(
      (editedDate.getTime() - originalDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    let schedulingPattern = 'no_change';
    if (Math.abs(timeShift) >= 2) {
      schedulingPattern = timeShift > 0 ? 'prefers_later_times' : 'prefers_earlier_times';
    }
    if (Math.abs(dayShift) >= 1) {
      schedulingPattern = dayShift > 0 ? 'prefers_later_dates' : 'prefers_earlier_dates';
    }

    return {
      timeShift,
      dayShift,
      schedulingPattern,
    };
  }
}

export default new AILearningService();
