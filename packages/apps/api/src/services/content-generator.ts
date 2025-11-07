import { randomUUID } from 'crypto';
import { logger as baseLogger } from '@postolio/logger';
import { getOpenAIClient, getDefaultOpenAIModel } from './openai-client.js';
import { shouldUsePlaceholderImages, generatePlaceholderImageUrl } from './image-placeholders.js';
import { generateMidjourneyImage } from './midjourney.js';
import { importImageFromExternalUrl } from './assets-media.js';
import type { AssetRecord } from '@postolio/assets-client';
import { getBrandProfileContext, type BrandProfileContext } from './brand-profile.js';
import { Prisma, type ContentStatus } from '@postolio/database';
import { SeasonalityService } from './seasonality.js';
import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();
const contentLogger = baseLogger.child({ module: 'content-generator' });

export interface ContentGenerationRequest {
  brandId: string;
  count: number;
  theme?: string | undefined;
  style?: string | undefined;
  // Optional: link generation to a specific campaign so we can include context
  campaignId?: string | undefined;
}

export interface GeneratedContent {
  caption: string;
  hashtags: string[];
  imagePrompt?: string;
  asset?: AssetRecord;
}

export interface ContentBatch {
  id: string;
  content: GeneratedContent[];
  brandId: string;
  createdAt: Date;
  metadata: {
    theme?: string | null;
    style?: string | null;
    generationParams: {
      count: number;
      theme?: string | null;
      style?: string | null;
      model: string;
    };
  };
}

export async function generateInstagramContent(
  brandName: string,
  request: ContentGenerationRequest
): Promise<GeneratedContent[]> {
  const openai = getOpenAIClient();
  if (!openai) {
    contentLogger.warn('OpenAI client is not configured. Returning fallback content batch.', {
      brandId: request.brandId,
    });
    let ctx: BrandProfileContext | null = null;
    try {
      ctx = await getBrandProfileContext(request.brandId);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      contentLogger.warn('Brand profile projection unavailable; using minimal context', {
        brandId: request.brandId,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
    }
    const safeCtx: Pick<BrandProfileContext, 'palette'> & {
      brandId: string;
      profileVersion: number;
      topicsTop: Array<{ value: string; count: number }> | null;
      createdAt: string;
    } = ctx || {
      brandId: request.brandId,
      profileVersion: 0,
      tones: [],
      palette: [],
      topicsTop: null,
      createdAt: new Date().toISOString(),
    };
    return buildFallbackGeneratedContent(safeCtx, brandName, request);
  }

  const { count, theme, style } = request;
  // Optional campaign context (type, pillars, promotions, seasonality)
  // Minimal campaign context shape to avoid heavy type coupling
  type CampaignCtx = {
    id: string;
    name: string;
    campaignType?: string | null;
    contentPillars?: { pillars?: Array<{ name: string; percentage?: number }> } | null;
    urgencyTactics?: {
      discountPercentage?: number;
      promoCode?: string;
      limitedQuantity?: boolean;
    } | null;
    seasonalContext?: unknown;
    config?: { themes?: string[] } | null;
  };
  let campaignCtx: CampaignCtx | null = null;
  if (request.campaignId) {
    try {
      const raw = await prisma.campaign.findUnique({
        where: { id: request.campaignId },
        select: {
          id: true,
          name: true,
          campaignType: true,
          contentPillars: true,
          urgencyTactics: true,
          seasonalContext: true,
          config: true,
        },
      });
      campaignCtx = raw as unknown as CampaignCtx;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      contentLogger.warn('Failed to load campaign context for generation; proceeding without it', {
        campaignId: request.campaignId,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
    }
  }
  let brandContext: BrandProfileContext | null = null;
  try {
    brandContext = await getBrandProfileContext(request.brandId);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    contentLogger.warn('Brand profile projection unavailable during generation', {
      brandId: request.brandId,
      error: { name: err.name, message: err.message, stack: err.stack },
    });
  }

  const tones = brandContext?.tones?.slice(0, 6) || [];
  const palette = brandContext?.palette?.slice(0, 5) || [];
  const motifs = brandContext?.motifs?.slice(0, 6) || [];
  const composition = brandContext?.composition?.slice(0, 5) || [];
  const topTopics = Array.isArray(brandContext?.topicsTop)
    ? brandContext!.topicsTop!.slice(0, 5).map((t) => t.value)
    : [];

  // Rolling window: fetch recent brand content to avoid repetition
  const windowCount = Number.isFinite(parseInt(process.env.ROLLING_WINDOW_POST_COUNT || ''))
    ? Math.max(1, parseInt(process.env.ROLLING_WINDOW_POST_COUNT as string, 10))
    : 20;
  const windowDays = Number.isFinite(parseInt(process.env.ROLLING_WINDOW_DAYS || ''))
    ? Math.max(0, parseInt(process.env.ROLLING_WINDOW_DAYS as string, 10))
    : 0; // 0 means ignore day filter

  type RecentItem = { caption: string | null; hashtags: string[] | null; createdAt: Date };
  const recentWhere: Prisma.ContentWhereInput = {
    brandId: request.brandId,
    status: { in: ['draft', 'scheduled', 'published'] as ContentStatus[] },
  };
  if (windowDays > 0) {
    recentWhere.createdAt = {
      gte: new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000),
    };
  }
  let recent: RecentItem[] = [];
  try {
    recent = await prisma.content.findMany({
      where: recentWhere,
      select: { caption: true, hashtags: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: windowCount,
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    contentLogger.warn('Failed to fetch recent content window; continuing without it', {
      brandId: request.brandId,
      windowCount,
      windowDays,
      error: { name: err.name, message: err.message, stack: err.stack },
    });
  }

  function firstWords(text: string, n = 5): string {
    const words = (text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, n);
    return words.join(' ');
  }
  function sanitizeTag(t: string): string {
    return t.replace(/^#+/, '').trim().toLowerCase();
  }

  const priorOpeners = Array.from(
    new Set(
      recent
        .map((r) => (r.caption ? firstWords(r.caption, 5) : ''))
        .filter((s) => s && s.length > 0)
    )
  ).slice(0, 20);

  const priorHashtagUsage = new Map<string, number>();
  for (const r of recent) {
    (r.hashtags || []).map(sanitizeTag).forEach((h) => {
      if (!h) return;
      priorHashtagUsage.set(h, (priorHashtagUsage.get(h) || 0) + 1);
    });
  }

  // Allow runtime tuning of diversity without code changes
  const bannedOpeners = (
    process.env.LLM_BANNED_OPENERS ||
    "Ready to,Let's,Let’s,Dive into,Explore,What’s your favorite,What's your favorite,Share in the comments"
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const dynamicBannedStarts = priorOpeners;

  const diversityRules = [
    `No two captions may start with the same first 5 words`,
    `Do not begin a caption with any of: ${[...bannedOpeners, ...dynamicBannedStarts].join('; ')}`,
    `Use varied hook styles across posts: bold statement, surprising fact, playful challenge, micro‑story, vivid analogy, and one rhetorical question at most`,
    `Vary sentence length and rhythm; avoid repeating the same opener patterns like “Ready to…”, “Let’s…”, “Dive into…”, “Explore…”, or “What’s your favorite…?”`,
    `Each caption must include a different subtle CTA (e.g., save for later, tag a friend, DM for tips, vote in comments, try this today)`,
  ].join('\n- ');

  // Campaign metadata
  const campaignType = campaignCtx?.campaignType || undefined || undefined;
  const allCampaignThemes: string[] = Array.isArray(campaignCtx?.config?.themes)
    ? (campaignCtx!.config!.themes as string[]).slice(0, 6)
    : [];
  let pillarNames: string[] = [];
  {
    const cp = campaignCtx?.contentPillars as unknown;
    if (cp && typeof cp === 'object' && 'pillars' in (cp as { [k: string]: unknown })) {
      const pillars = (cp as { pillars?: Array<{ name: string; percentage?: number }> }).pillars;
      pillarNames = Array.isArray(pillars) ? pillars.map((p) => p.name).slice(0, 6) : [];
    }
  }

  // Seasonality (Phase 1): compute factual season/holidays if enabled
  let seasonalityBlock = 'n/a';
  let seasonalityAssist = true;
  {
    const cfg = (campaignCtx?.config || {}) as { seasonalityAssist?: boolean };
    if (typeof cfg.seasonalityAssist === 'boolean') seasonalityAssist = cfg.seasonalityAssist;
  }
  if (request.campaignId && seasonalityAssist) {
    try {
      const sctx = await SeasonalityService.getSeasonalityForCampaign(request.campaignId);
      const seasonsStr = sctx.seasons
        .map((s: { name: string; start: string; end: string }) => `${s.name} (${s.start}→${s.end})`)
        .join('; ');
      const holidaysStr = sctx.holidays
        .map((h: { name: string; date: string }) => `${h.name} (${h.date})`)
        .join('; ');
      seasonalityBlock = `Hemisphere: ${sctx.hemisphere}. Seasons: ${seasonsStr || 'n/a'}. Holidays: ${holidaysStr || 'n/a'}.`;
    } catch {
      seasonalityBlock = 'n/a';
    }
  }

  const promoHint = (() => {
    const u = campaignCtx?.urgencyTactics as
      | { discountPercentage?: number; promoCode?: string; limitedQuantity?: boolean }
      | undefined;
    if (!u) return '';
    const parts: string[] = [];
    if (typeof u.discountPercentage === 'number') parts.push(`${u.discountPercentage}% discount`);
    if (u.promoCode) parts.push(`promo code ${u.promoCode}`);
    if (u.limitedQuantity) parts.push('limited quantity');
    return parts.length > 0
      ? `Promotion: ${parts.join(', ')}. Subtle CTA allowed (avoid sounding pushy).`
      : '';
  })();

  const systemPrompt = `You are an expert Instagram content creator for the brand "${brandName}".

Brand Context:
- Voice/Tone: ${tones.join(', ') || 'n/a'}
- Archetype: ${brandContext?.archetype || 'n/a'}
- Top Topics: ${topTopics.join(', ') || 'n/a'}
- Visual Identity:
  - Palette (hex): ${palette.join(', ') || 'n/a'}
  - Motifs: ${motifs.join(', ') || 'n/a'}
  - Composition: ${composition.join(', ') || 'n/a'}

Campaign Context:
${
  campaignCtx
    ? `- Internal Name (do not mention): ${campaignCtx.name}
- Type: ${campaignType || 'n/a'}
- Themes: ${allCampaignThemes.join(', ') || 'n/a'}
${pillarNames.length ? `- Pillars: ${pillarNames.join(', ')}` : ''}
${promoHint ? `- ${promoHint}` : ''}`
    : 'n/a'
}

Regional Seasonality (facts): ${seasonalityBlock}

Generation Requirements:
- Generate ${count} unique Instagram posts.
${theme ? `- Theme to reflect: "${theme}".` : ''}
${style ? `- Additional style note: "${style}".` : ''}
${campaignType ? `- Align with campaign type: ${campaignType}.` : ''}
- If seasons/holidays are listed above, subtly weave colors, motifs, or timing references where contextually appropriate. Do not invent holidays; do not overuse.
- Caption: 120–220 chars, conversational, include a subtle, brand‑appropriate CTA, NO hashtags in the caption.
 - Diversity: ensure strong variety across posts.\n- ${diversityRules}
 - Recent window awareness: do not repeat the first 5 words of any recent caption. Avoid recently used hashtags listed below when possible.
 - Hashtags: 5–10 relevant tokens (no #), bias to brand topics and audience; mix broad and niche where appropriate.
 - Hashtag diversity: across this batch, each post should include at least 3 hashtags not used in any other post; limit overlap between any two posts to at most 1 shared hashtag; avoid generic fillers like inspiration, community, brand, lifestyle, motivation.
- imagePrompt: include 1–2 motifs, 1–2 composition cues, and 2–4 brand palette hex codes (hex only), 1:1 framing, Instagram-ready, no text/watermarks.
 - Do not mention the campaign name directly; reflect its mood/themes implicitly.

Recent context (summarized):
- Prior caption starts (avoid as openers): ${dynamicBannedStarts.slice(0, 15).join(' | ') || 'n/a'}
- Recently used hashtags (avoid when possible): ${
    Array.from(priorHashtagUsage.keys()).slice(0, 30).join(', ') || 'n/a'
  }

Output JSON only with fields: caption, hashtags (array of strings with no #), imagePrompt.`;

  // Define JSON Schema for structured output
  const responseSchema = {
    type: 'object',
    properties: {
      posts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            caption: {
              type: 'string',
              description: 'Instagram caption without hashtags',
            },
            hashtags: {
              type: 'array',
              minItems: 5,
              maxItems: 10,
              items: {
                type: 'string',
              },
              description: 'Array of hashtags without # symbols',
            },
            imagePrompt: {
              type: 'string',
              description: 'Detailed prompt for image generation',
            },
          },
          required: ['caption', 'hashtags', 'imagePrompt'],
          additionalProperties: false,
        },
      },
    },
    required: ['posts'],
    additionalProperties: false,
  };

  try {
    contentLogger.info('Making OpenAI API call with structured output', {
      brandId: request.brandId,
      count,
      theme,
      style,
    });

    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI API call timeout')), 30000); // 30 second timeout
    });

    // LLM sampling/diversity tuning (env-overridable)
    const captionTemperature = Number.isFinite(
      parseFloat(process.env.LLM_CAPTION_TEMPERATURE || '')
    )
      ? parseFloat(process.env.LLM_CAPTION_TEMPERATURE as string)
      : 0.95;
    const presencePenalty = Number.isFinite(parseFloat(process.env.LLM_PRESENCE_PENALTY || ''))
      ? parseFloat(process.env.LLM_PRESENCE_PENALTY as string)
      : 0.6;
    const frequencyPenalty = Number.isFinite(parseFloat(process.env.LLM_FREQUENCY_PENALTY || ''))
      ? parseFloat(process.env.LLM_FREQUENCY_PENALTY as string)
      : 0.5;
    const topP = Number.isFinite(parseFloat(process.env.LLM_TOP_P || ''))
      ? parseFloat(process.env.LLM_TOP_P as string)
      : 0.9;

    const completionPromise = openai.chat.completions.create({
      model: getDefaultOpenAIModel(),
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: `Generate ${count} Instagram posts for ${brandName}. ${
            theme ? `Theme: ${theme}.` : ''
          } ${style ? `Style: ${style}.` : ''}`.trim(),
        },
      ],
      temperature: captionTemperature,
      top_p: topP,
      presence_penalty: presencePenalty,
      frequency_penalty: frequencyPenalty,
      max_tokens: 1500,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'instagram_posts',
          strict: true,
          schema: responseSchema,
        },
      },
    });

    type OpenAIChatChoice = { message?: { content?: string } };
    type OpenAIChatCompletion = { choices: OpenAIChatChoice[] };
    const completion = (await Promise.race([
      completionPromise,
      timeoutPromise,
    ])) as OpenAIChatCompletion;
    contentLogger.info('OpenAI API call completed successfully', {
      brandId: request.brandId,
      count,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content received from OpenAI');
    }

    // Parse the structured JSON response (guaranteed to be valid JSON with strict mode)
    interface StructuredResponse {
      posts: Array<{
        caption: string;
        hashtags: string[];
        imagePrompt: string;
      }>;
    }

    const structuredResponse = JSON.parse(content) as StructuredResponse;
    contentLogger.info('Structured content received from OpenAI', {
      posts: structuredResponse.posts.length,
      expected: count,
      brandId: request.brandId,
    });

    // Validate structure
    if (!structuredResponse.posts || !Array.isArray(structuredResponse.posts)) {
      throw new Error('Invalid response structure: missing posts array');
    }

    if (structuredResponse.posts.length !== count) {
      contentLogger.warn('OpenAI returned a different number of posts than requested', {
        received: structuredResponse.posts.length,
        expected: count,
        brandId: request.brandId,
      });
    }

    // Map structured response to GeneratedContent format
    // No need to clean hashtags - they're already in correct format from schema
    const generatedContent: GeneratedContent[] = structuredResponse.posts.map((post) => ({
      caption: post.caption.trim(),
      hashtags: post.hashtags,
      imagePrompt: post.imagePrompt,
    }));

    // Post-process: enforce hashtag diversity and sanitize tokens
    const bannedHashtags = (
      process.env.LLM_BANNED_HASHTAGS || 'inspiration,community,brand,lifestyle,motivation'
    )
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const maxReuse = Number.isFinite(parseInt(process.env.HASHTAG_MAX_GLOBAL_REUSE || ''))
      ? Math.max(0, parseInt(process.env.HASHTAG_MAX_GLOBAL_REUSE as string, 10))
      : 1;
    const minPerPost = Number.isFinite(parseInt(process.env.HASHTAG_MIN_PER_POST || ''))
      ? Math.max(0, parseInt(process.env.HASHTAG_MIN_PER_POST as string, 10))
      : 5;
    const maxPerPost = Number.isFinite(parseInt(process.env.HASHTAG_MAX_PER_POST || ''))
      ? Math.max(minPerPost, parseInt(process.env.HASHTAG_MAX_PER_POST as string, 10))
      : 10;

    const diversified = enforceHashtagDiversity(
      generatedContent,
      topTopics,
      brandName,
      bannedHashtags,
      { maxReuse, minPerPost, maxPerPost, theme, style },
      priorHashtagUsage
    );

    // Basic validation that content exists
    for (let i = 0; i < generatedContent.length; i++) {
      const item = generatedContent[i];
      if (!item.caption || item.caption.length === 0) {
        throw new Error(`Generated content item ${i + 1} has empty caption`);
      }
      if (!item.hashtags || item.hashtags.length === 0) {
        contentLogger.warn('Generated content item has no hashtags', {
          index: i,
          brandId: request.brandId,
        });
      }
    }

    // Generate images for each post using Midjourney (with DALL-E fallback)
    const contentWithImages = await Promise.all(
      diversified.map(async (item, index) => {
        try {
          // If model did not include strong brand/campaign cues in imagePrompt, augment with brand & campaign context
          let finalPrompt = item.imagePrompt || item.caption;
          if (brandContext) {
            const cueMotif = motifs[0] || '';
            const cueComp = composition[0] || '';
            const usePalette = palette.slice(0, 3);
            const paletteText = usePalette.length > 0 ? `, colors: ${usePalette.join(', ')}` : '';
            const motifText = cueMotif ? `, motif: ${cueMotif}` : '';
            const compText = cueComp ? `, composition: ${cueComp}` : '';
            finalPrompt = `${finalPrompt}${motifText}${compText}${paletteText}, 1:1, Instagram-ready, no text, no watermark`;
          }

          const imageUrl = await generateBrandContentImage(finalPrompt, brandContext, brandName);
          contentLogger.info('Generated image for content post', {
            brandId: request.brandId,
            index,
            promptPreview: finalPrompt?.substring(0, 50) ?? '',
            imagePreview: imageUrl ? imageUrl.substring(0, 80) : 'none',
            hasImage: Boolean(imageUrl),
          });

          if (imageUrl) {
            try {
              const asset = await importImageFromExternalUrl(imageUrl, {
                contentId: `${Date.now()}_${index}`,
                brandId: request.brandId,
                campaignId: request.campaignId,
                source: imageUrl.includes('dalle') ? 'dalle3' : 'midjourney',
                originalPrompt: finalPrompt,
              });

              return {
                ...item,
                asset,
              };
            } catch (assetError) {
              const err = assetError instanceof Error ? assetError : new Error(String(assetError));
              contentLogger.error('Failed to store generated image via assets service', {
                brandId: request.brandId,
                index,
                error: { name: err.name, message: err.message, stack: err.stack },
              });
              throw new Error(
                'Failed to store generated image: ' +
                  (assetError instanceof Error ? assetError.message : 'Unknown error')
              );
            }
          }

          // No image was generated
          return item;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          contentLogger.error('Brand image generation failed', {
            brandId: request.brandId,
            index,
            error: { name: err.name, message: err.message, stack: err.stack },
          });
          return item; // Return without image if generation fails
        }
      })
    );

    return contentWithImages;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    contentLogger.error('Content generation error', {
      brandId: request.brandId,
      error: { name: err.name, message: err.message, stack: err.stack },
    });

    // Check for specific OpenAI errors that should fail hard
    if (error instanceof Error) {
      if (error.message.includes('API key') || error.message.includes('authentication')) {
        contentLogger.error('OpenAI API key error - check OPENAI_API_KEY environment variable', {
          brandId: request.brandId,
        });
        throw new Error('OpenAI API key configuration error');
      }
      if (error.message.includes('insufficient_quota')) {
        contentLogger.error('OpenAI API quota exceeded', { brandId: request.brandId });
        throw new Error('OpenAI API quota exceeded');
      }
      if (error.message.includes('rate_limit')) {
        contentLogger.error('OpenAI API rate limit exceeded', { brandId: request.brandId });
        throw new Error('OpenAI API rate limit exceeded');
      }
    }

    // Return fallback content for other errors
    contentLogger.warn('Falling back to template content due to OpenAI error', {
      brandId: request.brandId,
    });
    let ctx: BrandProfileContext | null = null;
    try {
      ctx = await getBrandProfileContext(request.brandId);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      contentLogger.warn('Brand profile projection unavailable in fallback', {
        brandId: request.brandId,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
    }
    const safeCtx: Pick<BrandProfileContext, 'palette'> & {
      brandId: string;
      profileVersion: number;
      topicsTop: Array<{ value: string; count: number }> | null;
      createdAt: string;
    } = ctx || {
      brandId: request.brandId,
      profileVersion: 0,
      tones: [],
      palette: [],
      topicsTop: null,
      createdAt: new Date().toISOString(),
    };
    return buildFallbackGeneratedContent(safeCtx, brandName, request);
  }
}

function buildFallbackGeneratedContent(
  brandContext: Pick<BrandProfileContext, 'palette'>,
  brandName: string,
  request: ContentGenerationRequest
): GeneratedContent[] {
  const { count } = request;

  // Fallback content already has hashtags separated, so just ensure no # symbols
  return Array.from({ length: count }, (_, i) => ({
    caption: `Generated content ${
      i + 1
    } for ${brandName}. This engaging post captures the essence of your brand while connecting with your audience. Share your story and inspire your followers! 🌟`,
    hashtags: ['inspiration', 'lifestyle', 'authentic', 'community', 'brand'], // No # symbols
    imagePrompt: `A beautiful modern image featuring ${
      Array.isArray(brandContext.palette) && brandContext.palette.length >= 2
        ? `${brandContext.palette[0]} and ${brandContext.palette[1]}`
        : 'vibrant'
    } colors, 1:1, Instagram-ready, no text, no watermark`,
  }));
}

// Utilities: hashtag diversity and sanitization
function sanitizeHashToken(token: string): string {
  return token
    .replace(/^#+/, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function slugifyWord(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '');
}

function expandTopicHashtags(topic: string): string[] {
  const t = slugifyWord(topic);
  if (!t) return [];
  const variants = [
    t,
    `${t}tips`,
    `${t}guide`,
    `${t}facts`,
    `${t}101`,
    `${t}daily`,
    `${t}today`,
    `${t}insights`,
    `${t}ideas`,
    `${t}explained`,
    `learn${t}`,
    `${t}community`,
  ];
  return Array.from(new Set(variants.map(sanitizeHashToken))).filter(Boolean);
}

function buildHashtagPool(
  topics: string[],
  brandName: string,
  theme?: string,
  style?: string
): string[] {
  const pool = new Set<string>();
  const brand = slugifyWord(brandName);
  if (brand) {
    [brand, `${brand}life`, `${brand}stories`, `${brand}community`, `${brand}vibes`]
      .map(sanitizeHashToken)
      .forEach((t) => t && pool.add(t));
  }
  topics.forEach((tp) => expandTopicHashtags(tp).forEach((t) => pool.add(t)));
  if (theme) expandTopicHashtags(theme).forEach((t) => pool.add(t));
  if (style) expandTopicHashtags(style).forEach((t) => pool.add(t));
  // Generic safe fillers (kept short and neutral)
  ['howto', 'tips', 'guide', 'daily', 'today', 'facts', 'ideas', 'insights'].forEach((t) =>
    pool.add(t)
  );
  return Array.from(pool);
}

function enforceHashtagDiversity(
  content: GeneratedContent[],
  topTopics: string[],
  brandName: string,
  banned: string[],
  opts: {
    maxReuse: number;
    minPerPost: number;
    maxPerPost: number;
    theme?: string;
    style?: string;
  },
  seedUsage?: Map<string, number>
): GeneratedContent[] {
  const usage = new Map<string, number>(seedUsage ? Array.from(seedUsage.entries()) : []);
  const pool = buildHashtagPool(topTopics, brandName, opts.theme, opts.style);
  const bannedSet = new Set(banned.map((b) => sanitizeHashToken(b)));

  function nextCandidate(exclude: Set<string>): string | null {
    for (const cand of pool) {
      const used = usage.get(cand) || 0;
      if (used < opts.maxReuse && !exclude.has(cand) && !bannedSet.has(cand)) {
        return cand;
      }
    }
    return null;
  }

  const result: GeneratedContent[] = content.map((item) => ({ ...item }));

  for (const item of result) {
    // sanitize and dedupe
    const seen = new Set<string>();
    let tags = (item.hashtags || [])
      .map(sanitizeHashToken)
      .filter((t) => t && !bannedSet.has(t))
      .filter((t) => (seen.has(t) ? false : (seen.add(t), true)));

    // enforce global reuse limit
    const exclude = new Set<string>(tags);
    tags = tags.map((t) => {
      const used = usage.get(t) || 0;
      if (used >= opts.maxReuse) {
        const repl = nextCandidate(exclude);
        if (repl) {
          exclude.add(repl);
          usage.set(repl, (usage.get(repl) || 0) + 1);
          return repl;
        }
        return t; // fallback to original if no candidate
      }
      usage.set(t, used + 1);
      return t;
    });

    // ensure min count
    while (tags.length < opts.minPerPost) {
      const cand = nextCandidate(new Set(tags));
      if (!cand) break;
      tags.push(cand);
      usage.set(cand, (usage.get(cand) || 0) + 1);
    }

    // trim to max
    if (tags.length > opts.maxPerPost) {
      // Prefer keeping the earliest unique ones
      tags = tags.slice(0, opts.maxPerPost);
    }

    item.hashtags = tags;
  }

  return result;
}

export async function generateContentImage(prompt: string): Promise<string> {
  if (shouldUsePlaceholderImages()) {
    return generatePlaceholderImageUrl('1024x1024', `content-${Date.now()}`);
  }

  const openai = getOpenAIClient();

  if (!openai) {
    contentLogger.warn('OpenAI client is not configured. Cannot generate content image.', {
      promptPreview: prompt.substring(0, 50),
    });
    throw new Error('OpenAI API key configuration error');
  }

  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: `Create a high-quality Instagram-worthy image: ${prompt}. Professional photography style, visually appealing, social media optimized.`,
      size: '1024x1024',
      quality: 'hd',
      n: 1,
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) {
      throw new Error('No image URL received from DALL-E');
    }

    return imageUrl;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    contentLogger.error('Image generation error', {
      promptPreview: prompt.substring(0, 50),
      error: { name: err.name, message: err.message, stack: err.stack },
    });
    // Return a placeholder or throw error based on requirements
    throw new Error('Image generation failed');
  }
}

export async function generateBrandContentImage(
  prompt: string,
  brandContext: BrandProfileContext | null,
  brandName: string
): Promise<string> {
  if (shouldUsePlaceholderImages()) {
    return generatePlaceholderImageUrl('1024x1024', `${brandName}-${Date.now()}`);
  }

  try {
    // Try Midjourney first for higher quality, brand-consistent images
    contentLogger.info('Attempting Midjourney generation for brand content', {
      brand: brandName,
    });
    const imageUrl = await generateMidjourneyImage(prompt, brandContext, brandName);
    contentLogger.info('Midjourney generation successful', {
      brand: brandName,
      hasImage: Boolean(imageUrl),
    });
    return imageUrl;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    contentLogger.error('Midjourney generation failed, falling back to DALL-E', {
      brand: brandName,
      error: { name: err.name, message: err.message, stack: err.stack },
    });

    // Fallback to DALL-E with enhanced prompt that includes brand characteristics
    try {
      const openai = getOpenAIClient();

      if (!openai) {
        contentLogger.warn(
          'OpenAI client is not configured. Cannot generate DALL-E fallback image.',
          {
            brand: brandName,
          }
        );
        throw new Error('OpenAI API key configuration error');
      }

      const tones = brandContext?.tones?.slice(0, 2) || [];
      const palette = brandContext?.palette?.slice(0, 2) || [];

      let enhancedPrompt = `Create a high-quality Instagram-worthy image: ${prompt}`;

      // Add brand characteristics to DALL-E prompt
      if (tones.length > 0) {
        enhancedPrompt += `, ${tones.join(' and ')} style`;
      }

      if (palette.length > 0) {
        const colors = palette.join(' and ');
        enhancedPrompt += `, featuring ${colors} colors`;
      }

      enhancedPrompt +=
        '. Professional photography style, visually appealing, social media optimized.';

      contentLogger.info('Enhanced DALL-E prompt prepared', {
        brand: brandName,
        promptPreview: enhancedPrompt.substring(0, 80),
      });

      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt: enhancedPrompt,
        size: '1024x1024',
        quality: 'hd',
        n: 1,
      });

      const imageUrl = response.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error('No image URL received from DALL-E fallback');
      }

      contentLogger.info('DALL-E fallback generation successful', {
        brand: brandName,
        hasImage: Boolean(imageUrl),
      });
      return imageUrl;
    } catch (dalleError) {
      const errFallback = dalleError instanceof Error ? dalleError : new Error(String(dalleError));
      contentLogger.error('Both Midjourney and DALL-E failed', {
        brand: brandName,
        error: { name: errFallback.name, message: errFallback.message, stack: errFallback.stack },
      });
      throw new Error('Image generation failed for both Midjourney and DALL-E');
    }
  }
}

export async function generateContentBatch(
  brandId: string,
  brandName: string,
  requests: ContentGenerationRequest[]
): Promise<ContentBatch[]> {
  const batches = await Promise.all(
    requests.map(async (request) => {
      const content = await generateInstagramContent(brandName, request);

      return {
        id: `batch_${Date.now()}_${randomUUID()}`,
        content,
        brandId,
        createdAt: new Date(),
        metadata: {
          theme: request.theme || null,
          style: request.style || null,
          generationParams: {
            count: request.count,
            model: getDefaultOpenAIModel(),
            imageModel: 'dall-e-3',
          },
        },
      };
    })
  );

  return batches;
}
