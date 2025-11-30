/**
 * Goal Suggester Service
 *
 * 2-tier goal suggestion system:
 * 1. Tag-based template matching (flexible industry detection based on brand type)
 * 2. Campaign type fallbacks (always available)
 */

import { getDatabaseClient } from '../config/database.js';
import {
  GOAL_TEMPLATES,
  FALLBACK_GOALS_BY_TYPE,
  extractBrandTags,
  type CampaignType,
} from './goal-templates.js';

export interface GoalSuggestion {
  value: string;
  score: number; // 0..1
  source: 'template' | 'fallback' | 'user';
  badge?:
    | 'Best for your business'
    | 'Tailored for your brand'
    | 'Recommended'
    | 'Saved for your brand';
  reasons?: string[];
}

const MAX_GOALS = 8; // Maximum goals to return
const MAX_SAVED_GOALS = 20; // Cap how many user-saved goals we store per brand to avoid unbounded JSON growth

function normalizeGoalList(goals: unknown): string[] {
  if (!Array.isArray(goals)) return [];
  return Array.from(
    new Set(
      goals
        .filter((g): g is string => typeof g === 'string')
        .map((g) => g.trim())
        .filter((g) => g.length > 0)
    )
  ).slice(0, MAX_SAVED_GOALS);
}

function extractStoredGoals(preferences: unknown): string[] {
  if (!preferences || typeof preferences !== 'object') return [];
  const pref = preferences as Record<string, unknown>;
  // Support both current and legacy keys just in case
  const fromCustom = normalizeGoalList((pref as any).customGoals);
  const fromSaved = normalizeGoalList((pref as any).savedGoals);
  // Prefer explicit custom goals, fall back to savedGoals, and merge uniquely
  return Array.from(new Set([...fromCustom, ...fromSaved])).slice(0, MAX_SAVED_GOALS);
}

export async function storeUserGoals(brandId: string, goals: string[]): Promise<void> {
  const normalized = normalizeGoalList(goals);
  if (!normalized.length) return;

  const prisma = getDatabaseClient();
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { preferences: true },
  });
  if (!brand) return;

  const existing = extractStoredGoals(brand.preferences);
  const merged = Array.from(new Set([...normalized, ...existing])).slice(0, MAX_SAVED_GOALS);
  const existingPrefs = (brand.preferences as Record<string, unknown> | null) || {};

  try {
    await prisma.brand.update({
      where: { id: brandId },
      data: {
        preferences: { ...existingPrefs, customGoals: merged },
      },
    });
  } catch (error) {
    console.error('Failed to store user goals on brand', { brandId, error });
  }
}

/**
 * Suggest campaign goals using 2-tier algorithm
 */
export async function suggestGoals(params: {
  brandId: string;
  campaignType: CampaignType;
  limit?: number;
}): Promise<GoalSuggestion[]> {
  const { brandId, campaignType, limit = MAX_GOALS } = params;
  const prisma = getDatabaseClient();

  const suggestions: GoalSuggestion[] = [];
  let userGoalCount = 0;

  try {
    // Fetch brand to get styleProfile for Tier 1
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      select: {
        styleProfile: true,
        preferences: true,
      },
    });

    const storedUserGoals = extractStoredGoals(brand?.preferences);
    userGoalCount = storedUserGoals.length;
    const userGoalSuggestions: GoalSuggestion[] = storedUserGoals.map((goal, index) => ({
      value: goal,
      score: 1 - index * 0.01, // highest priority, stable ordering
      source: 'user',
      badge: 'Saved for your brand',
      reasons: ['Saved from your previous campaign goals'],
    }));
    suggestions.push(...userGoalSuggestions);

    // ============================================
    // Tier 1: Tag-based template matching
    // ============================================
    // Extract brand type from styleProfile
    const styleProfile = brand?.styleProfile as { brandType?: string } | null;
    const brandType = styleProfile?.brandType;
    const brandTags = extractBrandTags(brandType);

    // Score templates based on tag overlap and campaign type match
    const scoredTemplates = GOAL_TEMPLATES.map((template) => {
      let score = 0;

      // Tag matching score (0.4 - 0.8)
      const tagOverlap = brandTags.filter((tag) => template.tags.includes(tag)).length;
      const tagScore = tagOverlap > 0 ? 0.4 + Math.min(0.4, tagOverlap * 0.15) : 0;

      // Campaign type match bonus (0.2)
      const campaignTypeMatch = template.campaignTypes.includes(campaignType) ? 0.2 : 0;

      // Priority bonus (0.1)
      const priorityBonus = (template.priority || 1) > 1 ? 0.1 : 0;

      score = tagScore + campaignTypeMatch + priorityBonus;

      return {
        template,
        score,
        tagOverlap,
      };
    })
      .filter((item) => item.score > 0) // Only keep templates with some match
      .sort((a, b) => b.score - a.score)
      .slice(0, 20); // Top 20 scored templates

    // Add template-based suggestions
    for (const { template, score, tagOverlap } of scoredTemplates) {
      // Skip if we already have this goal from cache
      if (suggestions.some((s) => s.value === template.value)) continue;

      const reasons: string[] = [];
      if (tagOverlap > 0) {
        const matchedTags = brandTags.filter((tag) => template.tags.includes(tag));
        reasons.push(`Matches your brand: ${matchedTags.slice(0, 2).join(', ')}`);
      }
      if (template.campaignTypes.includes(campaignType)) {
        reasons.push(`Perfect for ${campaignType} campaigns`);
      }
      reasons.push('Source: industry best practices');

      suggestions.push({
        value: template.value,
        score: Math.min(0.85, score), // Cap template scores at 0.85
        source: 'template',
        badge: tagOverlap > 1 ? 'Recommended' : undefined,
        reasons,
      });
    }

    // ============================================
    // Tier 2: Campaign type fallbacks
    // ============================================
    const fallbackGoals = FALLBACK_GOALS_BY_TYPE[campaignType] || FALLBACK_GOALS_BY_TYPE.custom;

    for (const [index, goal] of fallbackGoals.entries()) {
      // Skip if we already have this goal
      if (suggestions.some((s) => s.value === goal)) continue;

      suggestions.push({
        value: goal,
        score: 0.3 - index * 0.05, // Lower scores: 0.3, 0.25, 0.2...
        source: 'fallback',
        reasons: [`Default for ${campaignType} campaigns`],
      });
    }
  } catch (error) {
    console.error('Error in suggestGoals:', error);

    // Emergency fallback: just use campaign type defaults
    const fallbackGoals = FALLBACK_GOALS_BY_TYPE[campaignType] || FALLBACK_GOALS_BY_TYPE.custom;
    return fallbackGoals.slice(0, limit).map((goal, index) => ({
      value: goal,
      score: 0.3 - index * 0.05,
      source: 'fallback' as const,
      reasons: [`Default for ${campaignType} campaigns`],
    }));
  }

  // Deduplicate by value (keep highest score)
  const uniqueGoals = new Map<string, GoalSuggestion>();
  for (const suggestion of suggestions) {
    const existing = uniqueGoals.get(suggestion.value);
    if (!existing || suggestion.score > existing.score) {
      uniqueGoals.set(suggestion.value, suggestion);
    }
  }

  const maxResults = Math.max(limit, typeof userGoalCount === 'number' ? userGoalCount : 0);
  // Sort by score and limit (always keep user goals, even if over requested limit)
  const sorted = Array.from(uniqueGoals.values()).sort((a, b) => b.score - a.score);
  return sorted.slice(0, maxResults);
}

/**
 * Auto-generate goals when user skips goal selection
 * Returns top 2-3 highest-scored suggestions
 */
export async function autoGenerateGoals(params: {
  brandId: string;
  campaignType: CampaignType;
}): Promise<string[]> {
  const suggestions = await suggestGoals({
    brandId: params.brandId,
    campaignType: params.campaignType,
    limit: 5,
  });

  // Take top 2-3 goals (prefer template over fallback)
  const topGoals = suggestions
    .filter((s) => s.source !== 'fallback' || suggestions.length < 2)
    .slice(0, 3);

  // If we only got fallbacks, take just 2
  if (topGoals.every((s) => s.source === 'fallback')) {
    return topGoals.slice(0, 2).map((s) => s.value);
  }

  return topGoals.map((s) => s.value);
}

/**
 * Ensure goals are present (auto-generate if skipped)
 * This is called from campaign creation to ensure we always have goals
 */
export async function ensureGoals(params: {
  goals?: string[];
  campaignType: CampaignType;
  brandId: string;
}): Promise<string[]> {
  // If user provided goals, use them
  if (params.goals && params.goals.length > 0) {
    // Enforce max 5 goals
    return params.goals.slice(0, 5);
  }

  // Auto-generate goals
  console.log('No goals provided, auto-generating based on brand and campaign type...');

  return autoGenerateGoals({
    brandId: params.brandId,
    campaignType: params.campaignType,
  });
}
