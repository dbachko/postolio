import { randomUUID } from 'crypto';
import { getOpenAIClient, getDefaultOpenAIModel } from '../../openai-client.js';
import { getBrandProfileContext, type BrandProfileContext } from '../../brand-profile.js';
import { contentLogger } from '../logger.js';
import { enforceHashtagDiversity } from '../hashtag-utils.js';
import { generateBrandContentImage } from '../image-generation.js';
import type { ContentGenerationRequest, GeneratedContent, ContentGenerator } from '../types.js';
import { loadBrandContext, loadRecentContentWindow, loadBrandLocation } from './context.js';
import { buildSystemPrompt } from './prompt.js';
import { buildFallbackGeneratedContent } from './fallback.js';
import { instagramResponseSchema, parseInstagramResponse } from './schema.js';
import { getInstagramSamplingConfig } from './config.js';

type SafeFallbackContext = Pick<BrandProfileContext, 'palette'> & {
  brandId: string;
  profileVersion: number;
  topicsTop: Array<{ value: string; count: number }> | null;
  createdAt: string;
};

function buildSafeFallbackContext(
  brandId: string,
  context: BrandProfileContext | null | undefined
): SafeFallbackContext {
  return (
    context || {
      brandId,
      profileVersion: 0,
      palette: [],
      topicsTop: null,
      createdAt: new Date().toISOString(),
    }
  );
}

async function loadFallbackContext(params: {
  brandId: string;
  reqId?: string;
  onErrorMessage: string;
}): Promise<SafeFallbackContext> {
  try {
    const profile = await getBrandProfileContext(params.brandId);
    return buildSafeFallbackContext(params.brandId, profile);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    contentLogger.warn(params.onErrorMessage, {
      reqId: params.reqId,
      brandId: params.brandId,
      error: { name: err.name, message: err.message, stack: err.stack },
    });
    return buildSafeFallbackContext(params.brandId, null);
  }
}

function parseIntEnv(name: string, fallback: number, min = 0): number {
  const parsed = parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, parsed);
}

function getHashtagConfig(theme: string | undefined, style: string | undefined) {
  const bannedHashtags = (
    process.env.LLM_BANNED_HASHTAGS || 'inspiration,community,brand,lifestyle,motivation'
  )
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return {
    bannedHashtags,
    options: {
      maxReuse: parseIntEnv('HASHTAG_MAX_GLOBAL_REUSE', 1),
      minPerPost: parseIntEnv('HASHTAG_MIN_PER_POST', 5),
      maxPerPost: parseIntEnv('HASHTAG_MAX_PER_POST', 10),
      theme,
      style,
    },
  };
}

function validateGeneratedContent(generatedContent: GeneratedContent[], brandId: string) {
  for (let index = 0; index < generatedContent.length; index++) {
    const item = generatedContent[index];
    if (!item.caption || item.caption.length === 0) {
      throw new Error(`Generated content item ${index + 1} has empty caption`);
    }
    if (!item.hashtags || item.hashtags.length === 0) {
      contentLogger.warn('Generated content item has no hashtags', {
        index,
        brandId,
      });
    }
  }
}

function buildImagePrompt(params: {
  item: GeneratedContent;
  motifs: string[];
  composition: string[];
  palette: string[];
  hasBrandContext: boolean;
}) {
  let finalPrompt = params.item.imagePrompt || params.item.caption;
  if (!params.hasBrandContext) {
    return finalPrompt;
  }

  const cueMotif = params.motifs[0] || '';
  const cueComp = params.composition[0] || '';
  const usePalette = params.palette.slice(0, 3);
  const paletteText = usePalette.length > 0 ? `, colors: ${usePalette.join(', ')}` : '';
  const motifText = cueMotif ? `, motif: ${cueMotif}` : '';
  const compText = cueComp ? `, composition: ${cueComp}` : '';
  finalPrompt = `${finalPrompt}${motifText}${compText}${paletteText}, 1:1, Instagram-ready, no text, no watermark`;
  return finalPrompt;
}

async function enrichContentWithImages(params: {
  diversified: GeneratedContent[];
  request: ContentGenerationRequest;
  brandName: string;
  brandContext: BrandProfileContext | null;
  motifs: string[];
  composition: string[];
  palette: string[];
}) {
  return Promise.all(
    params.diversified.map(async (item, index) => {
      try {
        const finalPrompt = buildImagePrompt({
          item,
          motifs: params.motifs,
          composition: params.composition,
          palette: params.palette,
          hasBrandContext: Boolean(params.brandContext),
        });

        const imageResult = await generateBrandContentImage(
          finalPrompt,
          params.brandContext,
          params.brandName,
          {
            preferredProvider: params.request.imageProvider,
            brandId: params.request.brandId,
          }
        );
        const imageUrl = imageResult.imageUrl;

        contentLogger.info('Generated image for content post', {
          brandId: params.request.brandId,
          index,
          promptPreview: finalPrompt?.substring(0, 50) ?? '',
          imagePreview: imageUrl ? imageUrl.substring(0, 80) : 'none',
          hasImage: Boolean(imageUrl),
          imageProvider: imageResult.provider,
        });

        if (!imageUrl) {
          return item;
        }

        return {
          ...item,
          imageUrl,
          imageMetadata: {
            source: imageResult.provider,
            originalPrompt: finalPrompt,
            assetId: imageResult.metadata.assetId,
          },
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        contentLogger.error('Brand image generation failed', {
          brandId: params.request.brandId,
          index,
          error: { name: err.name, message: err.message, stack: err.stack },
        });
        return item;
      }
    })
  );
}

function buildUserPrompt(brandName: string, request: ContentGenerationRequest) {
  return `Generate ${request.count} Instagram posts for ${brandName}. ${
    request.theme ? `Theme: ${request.theme}.` : ''
  } ${request.style ? `Style: ${request.style}.` : ''}`.trim();
}

async function requestOpenAiInstagramContent(params: {
  openai: any;
  systemPrompt: string;
  request: ContentGenerationRequest;
  brandName: string;
}) {
  const { captionTemperature, presencePenalty, frequencyPenalty, topP } =
    getInstagramSamplingConfig();

  const timeoutMs = 30000;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const completion = await params.openai.chat.completions.create(
      {
        model: getDefaultOpenAIModel(),
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: buildUserPrompt(params.brandName, params.request) },
        ],
        temperature: captionTemperature,
        top_p: topP,
        presence_penalty: presencePenalty,
        frequency_penalty: frequencyPenalty,
        max_completion_tokens: 1500,
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

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No content received from OpenAI');
    }
    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

function mapKnownOpenAiError(error: Error, brandId: string): never {
  if (error.message.includes('API key') || error.message.includes('authentication')) {
    contentLogger.error('OpenAI API key error - check OPENAI_API_KEY environment variable', {
      brandId,
    });
    throw new Error('OpenAI API key configuration error');
  }
  if (error.message.includes('insufficient_quota')) {
    contentLogger.error('OpenAI API quota exceeded', { brandId });
    throw new Error('OpenAI API quota exceeded');
  }
  if (error.message.includes('rate_limit')) {
    contentLogger.error('OpenAI API rate limit exceeded', { brandId });
    throw new Error('OpenAI API rate limit exceeded');
  }
  throw error;
}

async function generateWithOpenAi(params: {
  reqId: string;
  brandName: string;
  request: ContentGenerationRequest;
  openai: any;
}) {
  const { request, reqId, brandName, openai } = params;

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
  const nowISODate = new Date().toISOString().slice(0, 10);
  const brandCountryCode = (brandLocation?.countryCode as string | null | undefined) ?? null;
  const brandTimezone = (brandLocation?.postingTimezone as string | null | undefined) ?? null;

  const systemPrompt = buildSystemPrompt({
    brandName,
    count: request.count,
    brandContext,
    tones,
    palette,
    motifs,
    composition,
    topTopics,
    theme: request.theme,
    style: request.style,
    dynamicBannedStarts: priorOpeners,
    priorHashtagUsage,
    currentDateISO: nowISODate,
    brandCountryCode,
    brandTimezone,
  });

  const rawContent = await requestOpenAiInstagramContent({
    openai,
    systemPrompt,
    request,
    brandName,
  });

  const parsed = parseInstagramResponse(rawContent, {
    expectedCount: request.count,
    brandId: request.brandId,
  });

  const hashtagConfig = getHashtagConfig(request.theme, request.style);
  const diversified = enforceHashtagDiversity(
    parsed,
    topTopics,
    brandName,
    hashtagConfig.bannedHashtags,
    hashtagConfig.options,
    priorHashtagUsage
  );

  validateGeneratedContent(diversified, request.brandId);

  return enrichContentWithImages({
    diversified,
    request,
    brandName,
    brandContext,
    motifs,
    composition,
    palette,
  });
}

async function fallbackContent(params: {
  reqId?: string;
  brandName: string;
  request: ContentGenerationRequest;
  reasonMessage: string;
  fallbackContextErrorMessage: string;
}) {
  contentLogger.warn(params.reasonMessage, {
    reqId: params.reqId,
    brandId: params.request.brandId,
  });
  const safeContext = await loadFallbackContext({
    brandId: params.request.brandId,
    reqId: params.reqId,
    onErrorMessage: params.fallbackContextErrorMessage,
  });
  return buildFallbackGeneratedContent(safeContext, params.brandName, params.request);
}

export const generateInstagramContent: ContentGenerator = async (
  brandName,
  request
): Promise<GeneratedContent[]> => {
  const reqId = randomUUID();
  contentLogger.info('Starting Instagram content generation', {
    reqId,
    brandId: request.brandId,
    count: request.count,
  });

  const openai = getOpenAIClient();
  if (!openai) {
    return fallbackContent({
      reqId,
      brandName,
      request,
      reasonMessage: 'instagram.generateInstagramContent:usingFallbackDueToMissingOpenAI',
      fallbackContextErrorMessage: 'Brand profile projection unavailable; using minimal context',
    });
  }

  try {
    contentLogger.info('Calling OpenAI for Instagram content', {
      brandId: request.brandId,
      count: request.count,
      theme: request.theme,
      style: request.style,
    });

    const contentWithImages = await generateWithOpenAi({
      reqId,
      brandName,
      request,
      openai,
    });

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
      try {
        mapKnownOpenAiError(error, request.brandId);
      } catch (mappedError) {
        if (mappedError instanceof Error && mappedError.message !== error.message) {
          throw mappedError;
        }
      }
    }

    return fallbackContent({
      brandName,
      request,
      reasonMessage: 'Falling back to template content due to error',
      fallbackContextErrorMessage: 'Brand profile projection unavailable in fallback',
    });
  }
};
