import { z } from 'zod';
import { getOpenAIClient, getDefaultOpenAIModel } from './openai-client.js';
import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

export const AnalyzeGoalSchema = z.object({
  brandId: z.string().min(1),
  goal: z.string().min(1).max(1000),
  themes: z.array(z.string()).optional(),
  campaignType: z
    .enum(['promotional', 'educational', 'seasonal', 'thought_leadership', 'custom'])
    .optional(),
});

export type AnalyzeGoalInput = z.infer<typeof AnalyzeGoalSchema>;

export interface AnalyzeGoalResult {
  objectives: string[];
  keyMessages: string[];
  audienceHints: string[];
  riskFactors: string[];
  suggestedPillars: Array<{ name: string; percentage: number; themes: string[] }>;
  schedule: { frequency: 'daily' | 'every2days' | '3weekly'; rationale: string };
}

export const GenerateStrategySchema = z.object({
  brandId: z.string().min(1),
  name: z.string().min(1),
  goals: z.string().min(1),
  campaignType: z
    .enum(['promotional', 'educational', 'seasonal', 'thought_leadership', 'custom'])
    .optional(),
  timeline: z.object({ startDate: z.string(), endDate: z.string() }),
  themes: z.array(z.string()).min(1),
  style: z.string().min(1),
  frequency: z.enum(['daily', 'every2days', '3weekly']),
  postingTime: z.string().regex(/^\d{2}:\d{2}$/),
  promotionDetails: z
    .object({
      discountPercentage: z.number().int().min(0).max(100).optional(),
      promoCode: z.string().max(64).optional(),
      limitedQuantity: z.boolean().optional(),
    })
    .optional(),
});

export type GenerateStrategyInput = z.infer<typeof GenerateStrategySchema>;

export interface CampaignStrategy {
  contentPillars: { pillars: Array<{ name: string; percentage: number; themes: string[] }> };
  schedule: {
    phases: Array<{
      phase: string;
      startOffsetDays: number;
      frequency: 'daily' | 'every2days' | '3weekly';
      rationale: string;
    }>;
    postingTime: string;
  };
  predictions: {
    estimatedPosts: number;
    reach: { low: number; high: number };
    engagementRate: number; // 0..1
  };
  recommendations?: string[];
}

// Output schemas to validate and sanitize OpenAI responses
const PillarSchema = z.object({
  name: z.string().min(1),
  percentage: z.number().min(0).max(100),
  themes: z.array(z.string()).default([]),
});

const AnalyzeGoalOutputSchema = z.object({
  objectives: z.array(z.string()).default([]),
  keyMessages: z.array(z.string()).default([]),
  audienceHints: z.array(z.string()).default([]),
  riskFactors: z.array(z.string()).default([]),
  suggestedPillars: z.array(PillarSchema).min(1),
  schedule: z.object({
    frequency: z.enum(['daily', 'every2days', '3weekly']),
    rationale: z.string().default(''),
  }),
});

const StrategyOutputSchema = z.object({
  contentPillars: z.object({ pillars: z.array(PillarSchema).min(1) }),
  schedule: z.object({
    phases: z
      .array(
        z.object({
          phase: z.string().min(1),
          startOffsetDays: z.number().min(0),
          frequency: z.enum(['daily', 'every2days', '3weekly']),
          rationale: z.string().default(''),
        })
      )
      .min(1),
    postingTime: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  predictions: z.object({
    estimatedPosts: z.number().min(1),
    reach: z.object({ low: z.number().min(0), high: z.number().min(0) }),
    engagementRate: z.number().min(0).max(1),
  }),
  recommendations: z.array(z.string()).optional(),
});

function normalizePillars<T extends { name: string; percentage: number; themes?: string[] }>(
  pillars: T[]
): T[] {
  if (!pillars.length) return pillars;
  const sum = pillars.reduce((s, p) => s + (Number(p.percentage) || 0), 0);
  if (sum <= 0) {
    const even = Math.round(100 / pillars.length);
    const res = pillars.map((p) => ({ ...p, percentage: even }));
    // fix rounding to exact 100
    const diff = 100 - res.reduce((s, p) => s + p.percentage, 0);
    if (diff !== 0) res[0].percentage += diff;
    return res;
  }
  // scale to 100 and round
  const res = pillars.map((p) => ({
    ...p,
    percentage: Math.max(0, Math.round((p.percentage / sum) * 100)),
  }));
  const total = res.reduce((s, p) => s + p.percentage, 0);
  if (total !== 100) {
    // adjust the largest pillar to compensate rounding
    const idx = res.reduce(
      (imax, p, i, arr) => (p.percentage > arr[imax].percentage ? i : imax),
      0
    );
    res[idx].percentage += 100 - total;
  }
  return res;
}

async function getBrandHistoricalMetrics(brandId: string): Promise<{
  avgEngagementRate: number; // 0..1
  medianReach: number;
}> {
  // Pull recent content analytics if available
  const recent = await prisma.content.findMany({
    where: { brandId },
    select: { analytics: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const rates: number[] = [];
  const reaches: number[] = [];
  for (const c of recent) {
    const a = c.analytics as {
      likes?: number;
      comments?: number;
      saves?: number;
      reach?: number;
      impressions?: number;
    } | null;
    if (a && (a.likes || a.comments || a.saves || a.reach || a.impressions)) {
      const interactions = (a.likes ?? 0) + (a.comments ?? 0) + (a.saves ?? 0);
      const base = a.reach ?? a.impressions ?? 0;
      if (base > 0) rates.push(interactions / base);
      if (a.reach) reaches.push(a.reach);
    }
  }

  const avgEngagementRate = rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : 0.025; // 2.5% default
  const sorted = reaches.sort((a, b) => a - b);
  const medianReach = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1000; // default baseline

  return { avgEngagementRate, medianReach };
}

export async function analyzeGoal(input: AnalyzeGoalInput): Promise<AnalyzeGoalResult> {
  const openai = getOpenAIClient();
  const goals = input.goal;
  const defaults: AnalyzeGoalResult = {
    objectives: [goals],
    keyMessages: input.themes?.slice(0, 3) || [],
    audienceHints: ['followers', 'lookalike audience'],
    riskFactors: ['message dilution', 'posting fatigue'],
    suggestedPillars: (input.themes || ['Awareness', 'Product', 'Community'])
      .slice(0, 3)
      .map((t, i, arr) => ({
        name: typeof t === 'string' ? t : `Pillar ${i + 1}`,
        percentage: Math.round(100 / arr.length),
        themes: [typeof t === 'string' ? t : `Theme ${i + 1}`],
      })),
    schedule: { frequency: '3weekly', rationale: 'Balanced cadence to prevent fatigue' },
  };

  if (!openai) {
    console.warn('OpenAI not configured. Returning heuristic analyzeGoal result.');
    return defaults;
  }

  const prompt = `Extract a structured campaign brief from the user's goal and optional hints.
Return ONLY JSON with fields: objectives (string[]), keyMessages (string[]), audienceHints (string[]), riskFactors (string[]), suggestedPillars ({name, percentage, themes[]}[]), schedule ({frequency: 'daily'|'every2days'|'3weekly', rationale}).

Goal: ${goals}
CampaignType: ${input.campaignType ?? 'custom'}
Themes: ${(input.themes || []).join(', ')}
`;

  try {
    const res = await openai.chat.completions.create({
      model: getDefaultOpenAIModel(),
      messages: [
        { role: 'system', content: 'You are a precise marketing strategy assistant. JSON only.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 800,
    });
    const content = res.choices[0]?.message?.content;
    if (!content) return defaults;
    const raw = JSON.parse(content);
    const safe = AnalyzeGoalOutputSchema.safeParse(raw);
    if (!safe.success) return defaults;
    const normalized = {
      ...safe.data,
      suggestedPillars: normalizePillars(safe.data.suggestedPillars),
    } satisfies AnalyzeGoalResult;
    return normalized;
  } catch (e) {
    console.error('analyzeGoal OpenAI error', e);
    return defaults;
  }
}

export async function generateStrategy(input: GenerateStrategyInput): Promise<CampaignStrategy> {
  const { avgEngagementRate, medianReach } = await getBrandHistoricalMetrics(input.brandId);

  // Baseline estimate of posts
  const start = new Date(input.timeline.startDate);
  const end = new Date(input.timeline.endDate);
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const postsPerWeek = input.frequency === 'daily' ? 7 : input.frequency === 'every2days' ? 3.5 : 3;
  const estimatedPosts = Math.max(1, Math.round((days / 7) * postsPerWeek));

  const fallbackStrategy: CampaignStrategy = {
    contentPillars: {
      pillars: (input.themes || ['Awareness', 'Product', 'Community'])
        .slice(0, 3)
        .map((t, i, arr) => ({
          name: t,
          percentage: Math.round(100 / arr.length),
          themes: [t],
        })),
    },
    schedule: {
      phases: [
        {
          phase: 'Kickoff',
          startOffsetDays: 0,
          frequency: input.frequency,
          rationale: 'Initial momentum',
        },
        {
          phase: 'Mid-Campaign',
          startOffsetDays: Math.floor(days / 3),
          frequency: input.frequency,
          rationale: 'Maintain steady engagement',
        },
        {
          phase: 'Final Push',
          startOffsetDays: Math.floor((days * 2) / 3),
          frequency: input.frequency,
          rationale: 'Drive final conversions',
        },
      ],
      postingTime: input.postingTime,
    },
    predictions: {
      estimatedPosts,
      reach: {
        low: Math.round(medianReach * 0.6 * estimatedPosts),
        high: Math.round(medianReach * 1.4 * estimatedPosts),
      },
      engagementRate: avgEngagementRate,
    },
    recommendations: [
      'A/B test caption tone (conversational vs. direct CTA)',
      'Experiment with two hashtag sets per pillar',
    ],
  };

  const openai = getOpenAIClient();
  if (!openai) {
    console.warn('OpenAI not configured. Returning heuristic strategy.');
    return fallbackStrategy;
  }

  const prompt = `Design a concise Instagram campaign strategy as JSON only with fields:
contentPillars: { pillars: [{ name, percentage, themes[] }] }
schedule: { phases: [{ phase, startOffsetDays, frequency, rationale }], postingTime }
predictions: { estimatedPosts, reach: { low, high }, engagementRate }
recommendations: string[]

Constraints:
- Ensure pillar percentages sum to 100.
- Use frequency from input.
- Keep 3–5 pillars max.

Input:
Brand historical avg engagement rate: ${(avgEngagementRate * 100).toFixed(2)}%
Median reach per post: ${medianReach}
Campaign type: ${input.campaignType ?? 'custom'}
Goals: ${input.goals}
Themes: ${(input.themes || []).join(', ')}
Style: ${input.style}
Timeline days: ${days}
Posting time: ${input.postingTime}
`;

  try {
    const res = await openai.chat.completions.create({
      model: getDefaultOpenAIModel(),
      messages: [
        {
          role: 'system',
          content: 'You are a senior marketing strategist. Respond with JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 1200,
    });
    const content = res.choices[0]?.message?.content;
    if (!content) return fallbackStrategy;
    const raw = JSON.parse(content);
    const safe = StrategyOutputSchema.safeParse(raw);
    if (!safe.success) return fallbackStrategy;
    const normalized: CampaignStrategy = {
      ...safe.data,
      contentPillars: {
        pillars: normalizePillars(safe.data.contentPillars.pillars),
      },
    };
    return normalized;
  } catch (e) {
    console.error('generateStrategy OpenAI error', e);
    return fallbackStrategy;
  }
}
