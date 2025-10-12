import { randomUUID } from 'crypto';
import { getOpenAIClient, getDefaultOpenAIModel } from './openai-client.js';
import { generateMidjourneyImage } from './midjourney.js';
import { uploadImageToS3, type ImageMetadata } from './s3-image.js';
import { getBrandProfileContext, type BrandProfileContext } from './brand-profile.js';
import { Prisma, type ContentStatus } from '@postolio/database';
import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

export interface ContentGenerationRequest {
  brandId: string;
  count: number;
  theme?: string | undefined;
  style?: string | undefined;
}

export interface GeneratedContent {
  caption: string;
  hashtags: string[];
  imagePrompt?: string;
  imageUrl?: string;
  s3ImageKey?: string;
  cdnImageUrl?: string;
  imageRegion?: string;
  retentionExpiresAt?: Date;
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
    console.warn('OpenAI client is not configured. Returning fallback content batch.');
    let ctx: BrandProfileContext | null = null;
    try {
      ctx = await getBrandProfileContext(request.brandId);
    } catch (e) {
      console.warn('Brand profile projection unavailable; using minimal context', e);
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
  let brandContext: BrandProfileContext | null = null;
  try {
    brandContext = await getBrandProfileContext(request.brandId);
  } catch (e) {
    console.warn(
      'Brand profile projection unavailable during generation; proceeding without it',
      e
    );
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
    console.warn('Failed to fetch recent content window; continuing without it', e);
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

  const systemPrompt = `You are an expert Instagram content creator for the brand "${brandName}".

Brand Context:
- Voice/Tone: ${tones.join(', ') || 'n/a'}
- Archetype: ${brandContext?.archetype || 'n/a'}
- Top Topics: ${topTopics.join(', ') || 'n/a'}
- Visual Identity:
  - Palette (hex): ${palette.join(', ') || 'n/a'}
  - Motifs: ${motifs.join(', ') || 'n/a'}
  - Composition: ${composition.join(', ') || 'n/a'}

Generation Requirements:
- Generate ${count} unique Instagram posts.
${theme ? `- Theme to reflect: "${theme}".` : ''}
${style ? `- Additional style note: "${style}".` : ''}
- Caption: 120–220 chars, conversational, include a subtle, brand‑appropriate CTA, NO hashtags in the caption.
 - Diversity: ensure strong variety across posts.\n- ${diversityRules}
 - Recent window awareness: do not repeat the first 5 words of any recent caption. Avoid recently used hashtags listed below when possible.
 - Hashtags: 5–10 relevant tokens (no #), bias to brand topics and audience; mix broad and niche where appropriate.
 - Hashtag diversity: across this batch, each post should include at least 3 hashtags not used in any other post; limit overlap between any two posts to at most 1 shared hashtag; avoid generic fillers like inspiration, community, brand, lifestyle, motivation.
- imagePrompt: include 1–2 motifs, 1–2 composition cues, and 2–4 brand palette hex codes (hex only), 1:1 framing, Instagram-ready, no text/watermarks.

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
    console.log('Making OpenAI API call with structured output...');

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
    console.log('OpenAI API call completed successfully');

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
    console.log(
      `Received ${structuredResponse.posts.length} posts from structured output (expected ${count})`
    );

    // Validate structure
    if (!structuredResponse.posts || !Array.isArray(structuredResponse.posts)) {
      throw new Error('Invalid response structure: missing posts array');
    }

    if (structuredResponse.posts.length !== count) {
      console.warn(
        `Received ${structuredResponse.posts.length} posts, expected ${count}. Using what was received.`
      );
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
        console.warn(`Generated content item ${i + 1} has no hashtags`);
      }
    }

    // Generate images for each post using Midjourney (with DALL-E fallback)
    const contentWithImages = await Promise.all(
      diversified.map(async (item, index) => {
        try {
          // If model did not include strong brand cues in imagePrompt, augment with brand context
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
          console.log(
            'Generated image for post:',
            JSON.stringify({
              prompt: finalPrompt?.substring(0, 50) + '...',
              imageUrl: imageUrl?.substring(0, 80) + '...' || 'Failed to generate',
              urlLength: imageUrl?.length || 0,
            })
          );

          // Upload to S3 if image was generated successfully
          if (imageUrl && process.env.S3_IMAGES_BUCKET) {
            try {
              const metadata: ImageMetadata = {
                contentId: `${Date.now()}_${index}`, // Unique ID for content
                brandId: request.brandId,
                campaignId: undefined as string | undefined, // Will be set when content is saved
                generatedAt: new Date(),
                source: imageUrl.includes('dalle') ? 'dalle3' : 'midjourney',
                originalPrompt: finalPrompt,
              };

              const s3Result = await uploadImageToS3(imageUrl, metadata);

              return {
                ...item,
                s3ImageKey: s3Result.s3Key,
                imageRegion: s3Result.region,
                retentionExpiresAt: s3Result.retentionExpiresAt,
              };
            } catch (s3Error) {
              console.error('Failed to upload image to S3:', s3Error);
              // If S3 upload fails, throw error - we can't save content without S3 image
              throw new Error(
                'Failed to upload image to S3: ' +
                  (s3Error instanceof Error ? s3Error.message : 'Unknown error')
              );
            }
          }

          // No image was generated
          return item;
        } catch (error) {
          console.error('Brand image generation failed:', error);
          return item; // Return without image if generation fails
        }
      })
    );

    return contentWithImages;
  } catch (error) {
    console.error('Content generation error:', error);

    // Check for specific OpenAI errors that should fail hard
    if (error instanceof Error) {
      if (error.message.includes('API key') || error.message.includes('authentication')) {
        console.error('OpenAI API key error - check OPENAI_API_KEY environment variable');
        throw new Error('OpenAI API key configuration error');
      }
      if (error.message.includes('insufficient_quota')) {
        console.error('OpenAI API quota exceeded');
        throw new Error('OpenAI API quota exceeded');
      }
      if (error.message.includes('rate_limit')) {
        console.error('OpenAI API rate limit exceeded');
        throw new Error('OpenAI API rate limit exceeded');
      }
    }

    // Return fallback content for other errors
    console.warn('Falling back to template content due to OpenAI error');
    let ctx: BrandProfileContext | null = null;
    try {
      ctx = await getBrandProfileContext(request.brandId);
    } catch (e) {
      console.warn('Brand profile projection unavailable in fallback; using minimal context', e);
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
  const openai = getOpenAIClient();

  if (!openai) {
    console.warn('OpenAI client is not configured. Cannot generate content image.');
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
    console.error('Image generation error:', error);
    // Return a placeholder or throw error based on requirements
    throw new Error('Image generation failed');
  }
}

export async function generateBrandContentImage(
  prompt: string,
  brandContext: BrandProfileContext | null,
  brandName: string
): Promise<string> {
  try {
    // Try Midjourney first for higher quality, brand-consistent images
    console.log('Attempting Midjourney generation for brand content...');
    const imageUrl = await generateMidjourneyImage(prompt, brandContext, brandName);
    console.log('Midjourney generation successful');
    return imageUrl;
  } catch (error) {
    console.error('Midjourney generation failed, falling back to DALL-E:', error);

    // Fallback to DALL-E with enhanced prompt that includes brand characteristics
    try {
      const openai = getOpenAIClient();

      if (!openai) {
        console.warn('OpenAI client is not configured. Cannot generate DALL-E fallback image.');
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

      console.log('Enhanced DALL-E prompt:', enhancedPrompt);

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

      console.log('DALL-E fallback generation successful');
      return imageUrl;
    } catch (dalleError) {
      console.error('Both Midjourney and DALL-E failed:', dalleError);
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
