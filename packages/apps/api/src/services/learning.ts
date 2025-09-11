import { PrismaClient, Prisma } from '@postolio/database';
import OpenAI from 'openai';
import type { StyleProfile } from './ai.js';

const prisma = new PrismaClient();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
      hashtags: string[];
      imageUrl?: string;
      scheduledAt?: string;
    },
    editedContent: {
      caption: string;
      hashtags: string[];
      imageUrl?: string;
      scheduledAt?: string;
    }
  ): Promise<EditAnalysis> {
    console.log('Analyzing user edit for learning patterns...');

    const analysis: EditAnalysis = {
      captionChanges: await this.analyzeCaptionChanges(
        originalContent.caption,
        editedContent.caption
      ),
      hashtagChanges: await this.analyzeHashtagChanges(
        originalContent.hashtags,
        editedContent.hashtags
      ),
      imageChanges: this.analyzeImageChanges(originalContent.imageUrl, editedContent.imageUrl),
      timingChanges: this.analyzeTimingChanges(
        originalContent.scheduledAt,
        editedContent.scheduledAt
      ),
    };

    console.log('Edit analysis completed:', JSON.stringify(analysis));
    return analysis;
  }

  /**
   * Apply learning insights to update brand style profile
   */
  async applyLearningToStyleProfile(
    brandId: string,
    editAnalysis: EditAnalysis
  ): Promise<{
    updatedProfile: StyleProfile;
    insights: LearningInsight[];
    profileUpdates: StyleProfileUpdate[];
    appliedToFuturePosts: number;
  }> {
    console.log('Applying learning to style profile...');

    // Get current brand and style profile
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      select: { id: true, name: true, styleProfile: true, userId: true },
    });

    if (!brand) {
      throw new Error('Brand not found');
    }

    const currentProfile =
      (brand.styleProfile as unknown as StyleProfile) || this.getDefaultStyleProfile();
    const insights: LearningInsight[] = [];
    const profileUpdates: StyleProfileUpdate[] = [];

    // Analyze caption style changes
    if (editAnalysis.captionChanges.toneChange !== 'no_change') {
      const toneInsight = await this.generateToneInsight(
        editAnalysis.captionChanges,
        currentProfile
      );
      insights.push(toneInsight);

      if (toneInsight.confidence > 0.7) {
        const newToneOfVoice = this.adjustToneOfVoice(
          currentProfile.toneOfVoice,
          editAnalysis.captionChanges.toneChange
        );
        profileUpdates.push({
          field: 'toneOfVoice',
          oldValue: currentProfile.toneOfVoice,
          newValue: newToneOfVoice,
          confidence: toneInsight.confidence,
          reasoning: `User consistently edits content to be ${editAnalysis.captionChanges.toneChange.replace('_', ' ')}`,
        });
        currentProfile.toneOfVoice = newToneOfVoice;
      }
    }

    // Analyze hashtag preferences
    if (
      editAnalysis.hashtagChanges.addedCategories.length > 0 ||
      editAnalysis.hashtagChanges.removedCategories.length > 0
    ) {
      const hashtagInsight = await this.generateHashtagInsight(
        editAnalysis.hashtagChanges,
        currentProfile
      );
      insights.push(hashtagInsight);

      if (hashtagInsight.confidence > 0.6) {
        const updatedThemes = this.adjustContentThemes(
          currentProfile.contentThemes,
          editAnalysis.hashtagChanges.addedCategories,
          editAnalysis.hashtagChanges.removedCategories
        );
        if (JSON.stringify(updatedThemes) !== JSON.stringify(currentProfile.contentThemes)) {
          profileUpdates.push({
            field: 'contentThemes',
            oldValue: currentProfile.contentThemes,
            newValue: updatedThemes,
            confidence: hashtagInsight.confidence,
            reasoning: `User preferences detected: added ${editAnalysis.hashtagChanges.addedCategories.join(', ')}, removed ${editAnalysis.hashtagChanges.removedCategories.join(', ')}`,
          });
          currentProfile.contentThemes = updatedThemes;
        }
      }
    }

    // Analyze personality adjustments
    if (editAnalysis.captionChanges.personalityShift.length > 0) {
      const personalityInsight = await this.generatePersonalityInsight(
        editAnalysis.captionChanges.personalityShift,
        currentProfile
      );
      insights.push(personalityInsight);

      if (personalityInsight.confidence > 0.6) {
        const updatedPersonality = this.adjustBrandPersonality(
          currentProfile.brandPersonality,
          editAnalysis.captionChanges.personalityShift
        );
        if (
          JSON.stringify(updatedPersonality) !== JSON.stringify(currentProfile.brandPersonality)
        ) {
          profileUpdates.push({
            field: 'brandPersonality',
            oldValue: currentProfile.brandPersonality,
            newValue: updatedPersonality,
            confidence: personalityInsight.confidence,
            reasoning: `Brand personality refined based on user edit patterns: ${editAnalysis.captionChanges.personalityShift.join(', ')}`,
          });
          currentProfile.brandPersonality = updatedPersonality;
        }
      }
    }

    // Save updated profile to database
    await prisma.brand.update({
      where: { id: brandId },
      data: {
        styleProfile: JSON.parse(JSON.stringify(currentProfile)) as Prisma.InputJsonValue,
      },
    });

    // Estimate how many future posts this will affect
    const appliedToFuturePosts = await this.estimateFuturePostImpact(brandId, profileUpdates);

    console.log(
      `Learning applied: ${insights.length} insights, ${profileUpdates.length} profile updates, affecting ~${appliedToFuturePosts} future posts`
    );

    return {
      updatedProfile: currentProfile,
      insights,
      profileUpdates,
      appliedToFuturePosts,
    };
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
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
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
      console.error(
        'Caption analysis error:',
        JSON.stringify(error, Object.getOwnPropertyNames(error))
      );
      return {
        lengthChange,
        toneChange: 'no_change',
        emojiChange: 'no_change',
        callToActionChange: 'no_change',
        personalityShift: [],
      };
    }
  }

  /**
   * Analyze hashtag preference changes
   */
  private async analyzeHashtagChanges(
    original: string[],
    edited: string[]
  ): Promise<EditAnalysis['hashtagChanges']> {
    const originalSet = new Set(original);
    const editedSet = new Set(edited);

    const added = edited.filter((tag) => !originalSet.has(tag));
    const removed = original.filter((tag) => !editedSet.has(tag));
    const countChange = edited.length - original.length;

    // Categorize hashtags using AI
    try {
      const addedCategories = added.length > 0 ? await this.categorizeHashtags(added) : [];
      const removedCategories = removed.length > 0 ? await this.categorizeHashtags(removed) : [];

      return {
        countChange,
        addedCategories,
        removedCategories,
        popularityShift: this.analyzePopularityShift(added, removed),
      };
    } catch (error) {
      console.error(
        'Hashtag analysis error:',
        JSON.stringify(error, Object.getOwnPropertyNames(error))
      );
      return {
        countChange,
        addedCategories: [],
        removedCategories: [],
        popularityShift: 'no_change',
      };
    }
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

  /**
   * Categorize hashtags into content themes
   */
  private async categorizeHashtags(hashtags: string[]): Promise<string[]> {
    if (hashtags.length === 0) return [];

    try {
      const prompt = `Categorize these Instagram hashtags into content themes: ${hashtags.join(', ')}

Return a JSON array of theme categories (e.g., ["lifestyle", "business", "fashion", "food", "travel", "fitness", "technology", "art", "photography", "motivation"])

Focus on the primary theme each hashtag represents. Return only the JSON array.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
      });

      const categories = JSON.parse(response.choices[0]?.message?.content || '[]');
      return Array.isArray(categories) ? categories : [];
    } catch (error) {
      console.error(
        'Hashtag categorization error:',
        JSON.stringify(error, Object.getOwnPropertyNames(error))
      );
      return [];
    }
  }

  /**
   * Analyze if hashtag changes indicate popularity preference shift
   */
  private analyzePopularityShift(
    added: string[],
    removed: string[]
  ): 'more_popular' | 'more_niche' | 'no_change' {
    const popularHashtags = [
      'love',
      'instagood',
      'photooftheday',
      'beautiful',
      'happy',
      'follow',
      'like4like',
      'followme',
    ];

    const addedPopular = added.filter((tag) =>
      popularHashtags.some((popular) => tag.toLowerCase().includes(popular))
    ).length;

    const removedPopular = removed.filter((tag) =>
      popularHashtags.some((popular) => tag.toLowerCase().includes(popular))
    ).length;

    if (addedPopular > removedPopular) return 'more_popular';
    if (removedPopular > addedPopular) return 'more_niche';
    return 'no_change';
  }

  /**
   * Generate learning insights for different edit patterns
   */
  private async generateToneInsight(
    captionChanges: EditAnalysis['captionChanges'],
    _profile: StyleProfile
  ): Promise<LearningInsight> {
    void _profile;
    const confidence = captionChanges.toneChange !== 'no_change' ? 0.8 : 0.1;

    return {
      pattern: `User ${captionChanges.toneChange === 'more_casual' ? 'casualizes' : 'formalizes'} AI-generated captions`,
      confidence,
      category: 'caption_style',
      recommendation: `Generate content with ${captionChanges.toneChange === 'more_casual' ? 'more conversational' : 'more professional'} tone`,
      appliedToFuturePosts: confidence > 0.7 ? Math.floor(Math.random() * 10 + 5) : 0,
    };
  }

  private async generateHashtagInsight(
    hashtagChanges: EditAnalysis['hashtagChanges'],
    _profile: StyleProfile
  ): Promise<LearningInsight> {
    void _profile;
    const hasSignificantChange =
      hashtagChanges.addedCategories.length > 0 || hashtagChanges.removedCategories.length > 0;
    const confidence = hasSignificantChange ? 0.7 : 0.1;

    return {
      pattern: `User ${hashtagChanges.popularityShift === 'more_niche' ? 'prefers niche-specific' : 'adds popular'} hashtags`,
      confidence,
      category: 'hashtag_preference',
      recommendation: `Focus on ${hashtagChanges.addedCategories.join(' and ')} content themes`,
      appliedToFuturePosts: confidence > 0.6 ? Math.floor(Math.random() * 8 + 3) : 0,
    };
  }

  private async generatePersonalityInsight(
    personalityShift: string[],
    _profile: StyleProfile
  ): Promise<LearningInsight> {
    void _profile;
    const confidence = personalityShift.length > 0 ? 0.6 : 0.1;

    return {
      pattern: `Brand personality shifting towards: ${personalityShift.join(', ')}`,
      confidence,
      category: 'caption_style',
      recommendation: `Emphasize ${personalityShift[0] || 'authentic'} brand personality in content`,
      appliedToFuturePosts: confidence > 0.6 ? Math.floor(Math.random() * 12 + 6) : 0,
    };
  }

  /**
   * Helper methods to adjust style profile based on learning
   */
  private adjustToneOfVoice(currentTone: string, change: 'more_casual' | 'more_formal'): string {
    if (change === 'more_casual') {
      if (currentTone.includes('formal') || currentTone.includes('professional')) {
        return currentTone.replace(/formal|professional/gi, 'conversational');
      }
      return `${currentTone}, conversational`;
    } else {
      if (currentTone.includes('casual') || currentTone.includes('conversational')) {
        return currentTone.replace(/casual|conversational/gi, 'professional');
      }
      return `${currentTone}, professional`;
    }
  }

  private adjustContentThemes(
    currentThemes: string[],
    addedCategories: string[],
    removedCategories: string[]
  ): string[] {
    const themes = [...currentThemes];

    // Add new themes that aren't already present
    addedCategories.forEach((category) => {
      if (!themes.includes(category)) {
        themes.push(category);
      }
    });

    // Remove themes that user consistently removes
    const filteredThemes = themes.filter((theme) => !removedCategories.includes(theme));

    // Keep maximum of 6 themes for focus
    return filteredThemes.slice(0, 6);
  }

  private adjustBrandPersonality(
    currentPersonality: string[],
    personalityShifts: string[]
  ): string[] {
    const personality = [...currentPersonality];

    // Add new personality traits
    personalityShifts.forEach((trait) => {
      if (!personality.includes(trait)) {
        personality.push(trait);
      }
    });

    // Keep maximum of 5 personality traits
    return personality.slice(0, 5);
  }

  private async estimateFuturePostImpact(
    brandId: string,
    updates: StyleProfileUpdate[]
  ): Promise<number> {
    if (updates.length === 0) return 0;

    // Estimate based on average posting frequency
    const recentContent = await prisma.content.count({
      where: {
        brandId,
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        },
      },
    });

    const dailyAverage = recentContent / 30;
    const weeklyEstimate = dailyAverage * 7;

    // Each significant update affects multiple future posts
    return Math.floor(weeklyEstimate * updates.length * 2);
  }

  private getDefaultStyleProfile(): StyleProfile {
    return {
      colorPalette: ['#333333', '#ffffff'],
      aestheticStyle: 'Modern and clean',
      contentThemes: ['lifestyle', 'brand'],
      toneOfVoice: 'Professional and friendly',
      targetAudience: 'General audience',
      brandPersonality: ['authentic', 'approachable'],
    };
  }
}

export default new AILearningService();
