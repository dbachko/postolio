import { randomUUID } from 'crypto';
import { getOpenAIClient, getDefaultOpenAIModel } from '../../openai-client.js';
import { getBrandProfileContext, type BrandProfileContext } from '../../brand-profile.js';
import { contentLogger } from '../logger.js';
import { enforceHashtagDiversity } from '../hashtag-utils.js';
import { generateBrandContentImage } from '../image-generation.js';
import type { ContentGenerationRequest, GeneratedContent, ContentGenerator } from '../types.js';
import {
  loadBrandContext,
  loadCampaignContext,
  loadRecentContentWindow,
  loadBrandLocation,
} from './context.js';
import { buildPromoHint, buildSystemPrompt } from './prompt.js';
import { buildFallbackGeneratedContent } from './fallback.js';
import { instagramResponseSchema, parseInstagramResponse } from './schema.js';
import { getInstagramSamplingConfig } from './config.js';
import type { CampaignContext } from './types.js';

export const generateInstagramContent: ContentGenerator = async (
  brandName,
  request
): Promise<GeneratedContent[]> => {
  const reqId = randomUUID();
  contentLogger.info('Starting Instagram content generation', {
    reqId,
    brandId: request.brandId,
    count: request.count,
    campaignId: request.campaignId,
  });

  const openai = getOpenAIClient();
  if (!openai) {
    contentLogger.warn('OpenAI client is not configured. Returning fallback content batch.', {
      reqId,
      brandId: request.brandId,
    });
    let brandContext: BrandProfileContext | null = null;
    try {
      brandContext = await getBrandProfileContext(request.brandId);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      contentLogger.warn('Brand profile projection unavailable; using minimal context', {
        reqId,
        brandId: request.brandId,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
    }
    const safeContext: Pick<BrandProfileContext, 'palette'> & {
      brandId: string;
      profileVersion: number;
      topicsTop: Array<{ value: string; count: number }> | null;
      createdAt: string;
    } = brandContext || {
      brandId: request.brandId,
      profileVersion: 0,
      palette: [],
      topicsTop: null,
      createdAt: new Date().toISOString(),
    };
    contentLogger.warn('instagram.generateInstagramContent:usingFallbackDueToMissingOpenAI', {
      reqId,
      brandId: request.brandId,
    });
    return buildFallbackGeneratedContent(safeContext, brandName, request);
  }

  const { count, theme, style } = request;

  const campaignContext = request.campaignId
    ? await loadCampaignContext(request.campaignId, reqId)
    : null;

  const brandContext = await loadBrandContext(request.brandId, reqId);
  const brandLocation = await loadBrandLocation(request.brandId, reqId);

  const tones = brandContext?.tones?.slice(0, 6) || [];
  const palette = brandContext?.palette?.slice(0, 5) || [];
  const motifs = brandContext?.motifs?.slice(0, 6) || [];
  const composition = brandContext?.composition?.slice(0, 5) || [];
  const topTopics = Array.isArray(brandContext?.topicsTop)
    ? brandContext.topicsTop!.slice(0, 5).map((topic) => topic.value)
    : [];

  const { priorOpeners, priorHashtagUsage } = await loadRecentContentWindow(request.brandId, reqId);

  const campaignType = campaignContext?.campaignType || undefined;
  const campaignThemes: string[] = Array.isArray(campaignContext?.config?.themes)
    ? (campaignContext!.config!.themes as string[]).slice(0, 6)
    : [];

  let pillarNames: string[] = [];
  if (campaignContext?.contentPillars && typeof campaignContext.contentPillars === 'object') {
    const cp = campaignContext.contentPillars as { pillars?: Array<{ name: string }> };
    const pillars = cp.pillars;
    pillarNames = Array.isArray(pillars) ? pillars.map((pillar) => pillar.name).slice(0, 6) : [];
  }

  const promoHint = buildPromoHint(campaignContext);
  const nowISODate = new Date().toISOString().slice(0, 10);
  const brandCountryCode = (brandLocation?.countryCode as string | null | undefined) ?? null;
  const brandTimezone = (brandLocation?.postingTimezone as string | null | undefined) ?? null;

  const dynamicBannedStarts = priorOpeners;
  const systemPrompt = buildSystemPrompt({
    brandName,
    count,
    brandContext,
    tones,
    palette,
    motifs,
    composition,
    topTopics,
    campaignContext,
    campaignType,
    campaignThemes,
    pillarNames,
    promoHint,
    theme,
    style,
    dynamicBannedStarts,
    priorHashtagUsage,
    currentDateISO: nowISODate,
    brandCountryCode,
    brandTimezone,
  });

  try {
    contentLogger.info('Calling OpenAI for Instagram content', {
      brandId: request.brandId,
      count,
      theme,
      style,
    });

    const { captionTemperature, presencePenalty, frequencyPenalty, topP } =
      getInstagramSamplingConfig();

    const timeoutMs = 30000;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    const completionPromise = openai.chat.completions.create(
      {
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
            schema: instagramResponseSchema,
          },
        },
      },
      {
        signal: abortController.signal,
        timeout: timeoutMs,
      }
    );

    type OpenAIChatChoice = { message?: { content?: string } };
    type OpenAIChatCompletion = { choices: OpenAIChatChoice[] };
    const completion = (await completionPromise) as OpenAIChatCompletion;
    clearTimeout(timeoutId);

    contentLogger.info('OpenAI call for Instagram content completed', {
      brandId: request.brandId,
      count,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content received from OpenAI');
    }

    const generatedContent: GeneratedContent[] = parseInstagramResponse(content, {
      expectedCount: count,
      brandId: request.brandId,
    });

    const bannedHashtags = (
      process.env.LLM_BANNED_HASHTAGS || 'inspiration,community,brand,lifestyle,motivation'
    )
      .split(',')
      .map((value) => value.trim().toLowerCase())
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

    for (let index = 0; index < generatedContent.length; index++) {
      const item = generatedContent[index];
      if (!item.caption || item.caption.length === 0) {
        throw new Error(`Generated content item ${index + 1} has empty caption`);
      }
      if (!item.hashtags || item.hashtags.length === 0) {
        contentLogger.warn('Generated content item has no hashtags', {
          index,
          brandId: request.brandId,
        });
      }
    }

    const contentWithImages = await Promise.all(
      diversified.map(async (item, index) => {
        try {
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
            return {
              ...item,
              imageUrl,
              imageMetadata: {
                source: imageUrl.includes('dalle') ? 'dalle3' : 'midjourney',
                originalPrompt: finalPrompt,
              },
            };
          }

          return item;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          contentLogger.error('Brand image generation failed', {
            brandId: request.brandId,
            index,
            error: { name: err.name, message: err.message, stack: err.stack },
          });
          return item;
        }
      })
    );

    contentLogger.info('Instagram content generation successful', {
      brandId: request.brandId,
      count: contentWithImages.length,
    });

    return contentWithImages;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    contentLogger.error('Instagram content generation error', {
      brandId: request.brandId,
      error: { name: err.name, message: err.message, stack: err.stack },
    });

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

    contentLogger.warn('Falling back to template content due to error', {
      brandId: request.brandId,
    });
    let brandContextForFallback: BrandProfileContext | null = null;
    try {
      brandContextForFallback = await getBrandProfileContext(request.brandId);
    } catch (fallbackError) {
      const errFallback =
        fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
      contentLogger.warn('Brand profile projection unavailable in fallback', {
        brandId: request.brandId,
        error: {
          name: errFallback.name,
          message: errFallback.message,
          stack: errFallback.stack,
        },
      });
    }
    const safeContext: Pick<BrandProfileContext, 'palette'> & {
      brandId: string;
      profileVersion: number;
      topicsTop: Array<{ value: string; count: number }> | null;
      createdAt: string;
    } = brandContextForFallback || {
      brandId: request.brandId,
      profileVersion: 0,
      palette: [],
      topicsTop: null,
      createdAt: new Date().toISOString(),
    };
    return buildFallbackGeneratedContent(safeContext, brandName, request);
  }
};
