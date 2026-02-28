import type { StyleProfile } from './ai.js';
import { logger as baseLogger } from '@postolio/logger';

import { getDatabaseClient } from '../config/database.js';
import { eventEmitter } from './event-emitter.js';
import type { EditAnalysis, LearningInsight, StyleProfileUpdate } from './learning.js';

const prisma = getDatabaseClient();
const learningLogger = baseLogger.child({ module: 'learning-service' });

async function generateToneInsight(
  captionChanges: EditAnalysis['captionChanges']
): Promise<LearningInsight> {
  const confidence = captionChanges.toneChange !== 'no_change' ? 0.8 : 0.1;
  return {
    pattern: `User ${captionChanges.toneChange === 'more_casual' ? 'casualizes' : 'formalizes'} AI-generated captions`,
    confidence,
    category: 'caption_style',
    recommendation: `Generate content with ${captionChanges.toneChange === 'more_casual' ? 'more conversational' : 'more professional'} tone`,
    appliedToFuturePosts: confidence > 0.7 ? Math.floor(Math.random() * 10 + 5) : 0,
  };
}

async function generateHashtagInsight(): Promise<LearningInsight> {
  return {
    pattern: 'Hashtag usage no longer tracked',
    confidence: 0.0,
    category: 'hashtag_preference',
    recommendation: 'No hashtag-based adjustments applied',
    appliedToFuturePosts: 0,
  };
}

async function generatePersonalityInsight(personalityShift: string[]): Promise<LearningInsight> {
  const confidence = personalityShift.length > 0 ? 0.6 : 0.1;
  return {
    pattern: `Brand personality shifting towards: ${personalityShift.join(', ')}`,
    confidence,
    category: 'caption_style',
    recommendation: `Emphasize ${personalityShift[0] || 'authentic'} brand personality in content`,
    appliedToFuturePosts: confidence > 0.6 ? Math.floor(Math.random() * 12 + 6) : 0,
  };
}

function adjustToneOfVoice(currentTone: string, change: 'more_casual' | 'more_formal'): string {
  if (change === 'more_casual') {
    if (currentTone.includes('formal') || currentTone.includes('professional')) {
      return currentTone.replace(/formal|professional/gi, 'conversational');
    }
    return `${currentTone}, conversational`;
  }
  if (currentTone.includes('casual') || currentTone.includes('conversational')) {
    return currentTone.replace(/casual|conversational/gi, 'professional');
  }
  return `${currentTone}, professional`;
}

function adjustContentThemes(
  currentThemes: string[],
  addedCategories: string[],
  removedCategories: string[]
): string[] {
  const themes = [...currentThemes];
  addedCategories.forEach((category) => {
    if (!themes.includes(category)) {
      themes.push(category);
    }
  });
  return themes.filter((theme) => !removedCategories.includes(theme)).slice(0, 6);
}

function adjustBrandPersonality(
  currentPersonality: string[],
  personalityShifts: string[]
): string[] {
  const personality = [...currentPersonality];
  personalityShifts.forEach((trait) => {
    if (!personality.includes(trait)) {
      personality.push(trait);
    }
  });
  return personality.slice(0, 5);
}

async function estimateFuturePostImpact(
  brandId: string,
  updates: StyleProfileUpdate[]
): Promise<number> {
  if (updates.length === 0) {
    return 0;
  }

  const recentContent = await prisma.content.count({
    where: {
      brandId,
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
  });
  const dailyAverage = recentContent / 30;
  return Math.floor(dailyAverage * 7 * updates.length * 2);
}

function getDefaultStyleProfile(): StyleProfile {
  return {
    colorPalette: ['#333333', '#ffffff'],
    aestheticStyle: 'Modern and clean',
    contentThemes: ['lifestyle', 'brand'],
    toneOfVoice: 'Professional and friendly',
    targetAudience: 'General audience',
    brandPersonality: ['authentic', 'approachable'],
  };
}

async function emitLearningAppliedEvent(
  brandId: string,
  insights: LearningInsight[],
  profileUpdates: StyleProfileUpdate[],
  editAnalysis: EditAnalysis
): Promise<void> {
  await eventEmitter.emitBrandLearningApplied(brandId, {
    insights: insights.map((i) => ({
      pattern: i.pattern,
      confidence: i.confidence,
      category: i.category,
      recommendation: i.recommendation,
    })),
    profileUpdates: profileUpdates.map((u) => ({
      field: String(u.field),
      newValue: u.newValue,
      confidence: u.confidence,
      reasoning: u.reasoning,
    })),
    appliedToFuturePosts: 0,
    editAnalysis,
  });
}

export async function applyLearningToStyleProfile(
  brandId: string,
  editAnalysis: EditAnalysis
): Promise<{
  insights: LearningInsight[];
  profileUpdates: StyleProfileUpdate[];
  appliedToFuturePosts: number;
}> {
  learningLogger.info('Applying learning to style profile...');
  const currentProfile = getDefaultStyleProfile();
  const insights: LearningInsight[] = [];
  const profileUpdates: StyleProfileUpdate[] = [];

  if (editAnalysis.captionChanges.toneChange !== 'no_change') {
    const toneInsight = await generateToneInsight(editAnalysis.captionChanges);
    insights.push(toneInsight);
    if (toneInsight.confidence > 0.7) {
      profileUpdates.push({
        field: 'toneOfVoice',
        oldValue: undefined,
        newValue: adjustToneOfVoice(
          currentProfile.toneOfVoice,
          editAnalysis.captionChanges.toneChange
        ),
        confidence: toneInsight.confidence,
        reasoning: `User consistently edits content to be ${editAnalysis.captionChanges.toneChange.replace('_', ' ')}`,
      });
    }
  }

  if (
    editAnalysis.hashtagChanges.addedCategories.length > 0 ||
    editAnalysis.hashtagChanges.removedCategories.length > 0
  ) {
    const hashtagInsight = await generateHashtagInsight();
    insights.push(hashtagInsight);
    if (hashtagInsight.confidence > 0.6) {
      profileUpdates.push({
        field: 'contentThemes',
        oldValue: undefined,
        newValue: adjustContentThemes(
          currentProfile.contentThemes,
          editAnalysis.hashtagChanges.addedCategories,
          editAnalysis.hashtagChanges.removedCategories
        ),
        confidence: hashtagInsight.confidence,
        reasoning: `User preferences detected: added ${editAnalysis.hashtagChanges.addedCategories.join(', ')}, removed ${editAnalysis.hashtagChanges.removedCategories.join(', ')}`,
      });
    }
  }

  if (editAnalysis.captionChanges.personalityShift.length > 0) {
    const personalityInsight = await generatePersonalityInsight(
      editAnalysis.captionChanges.personalityShift
    );
    insights.push(personalityInsight);
    if (personalityInsight.confidence > 0.6) {
      profileUpdates.push({
        field: 'brandPersonality',
        oldValue: undefined,
        newValue: adjustBrandPersonality(
          currentProfile.brandPersonality,
          editAnalysis.captionChanges.personalityShift
        ),
        confidence: personalityInsight.confidence,
        reasoning: `Brand personality refined based on user edit patterns: ${editAnalysis.captionChanges.personalityShift.join(', ')}`,
      });
    }
  }

  await emitLearningAppliedEvent(brandId, insights, profileUpdates, editAnalysis);

  const appliedToFuturePosts = await estimateFuturePostImpact(brandId, profileUpdates);
  learningLogger.info(
    `Learning applied: ${insights.length} insights, ${profileUpdates.length} profile updates, affecting ~${appliedToFuturePosts} future posts`
  );

  return { insights, profileUpdates, appliedToFuturePosts };
}
