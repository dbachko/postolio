import type { Prisma } from '@postolio/database';
import { createHash } from 'node:crypto';
import { prisma } from '../../config/database.js';
import { acquireDistributedLock } from '../distributed-lock.js';
import { RecipeConfigSchema, type RecipeConfig } from './config-schema.js';

type CuratedRecipeSeed = {
  slug: string;
  name: string;
  description: string;
  category: 'get_started' | 'content' | 'growth' | 'social' | 'other';
  config: RecipeConfig;
};

type InputFieldSeed = {
  key: string;
  type: 'input' | 'textarea' | 'select' | 'date' | 'asset_picker' | 'asset_reference_selector';
  label: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
  options?: Array<string | { label: string; value: string }>;
  multiple?: boolean;
  max?: number;
  default?: unknown;
  schema?: Record<string, unknown>;
};

const MIN_CURATED_RECIPE_COUNT = 12;
const MIN_ASSET_PICKER_RECIPES = 2;
export const CURATED_RECIPE_CATALOG_VERSION = '2026-02-11-m5.3';

function normalizeOptions(
  options: InputFieldSeed['options']
): Array<{ label: string; value: string }> {
  return (options || []).map((option) =>
    typeof option === 'string'
      ? {
          label: option,
          value: option,
        }
      : option
  );
}

function fieldSchema(field: InputFieldSeed): Record<string, unknown> {
  if (field.schema) {
    return field.schema;
  }

  if (field.type === 'date') {
    return {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    };
  }

  if (field.type === 'asset_picker' || field.type === 'asset_reference_selector') {
    return {
      type: 'array',
      items: { type: 'string' },
      ...(field.required ? { minItems: 1 } : {}),
    };
  }

  if (field.type === 'select') {
    const options = normalizeOptions(field.options);
    return {
      type: 'string',
      enum: options.map((option) => option.value),
      ...(field.required ? { minLength: 1 } : {}),
    };
  }

  return {
    type: 'string',
    ...(field.required ? { minLength: 1 } : {}),
  };
}

function buildInputs(fields: InputFieldSeed[]) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const field of fields) {
    properties[field.key] = fieldSchema(field);
    if (field.required) {
      required.push(field.key);
    }
  }

  return {
    schema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
    ui: fields.map((field) => ({
      key: field.key,
      type: field.type,
      label: field.label,
      required: Boolean(field.required),
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      ...(field.description ? { description: field.description } : {}),
      ...(field.options ? { options: normalizeOptions(field.options) } : {}),
      ...(field.multiple !== undefined ? { multiple: field.multiple } : {}),
      ...(field.max !== undefined ? { max: field.max } : {}),
      ...(field.default !== undefined ? { default: field.default } : {}),
    })),
  };
}

function makePostsStructuredOutputSchema(args: {
  count?: number;
  minCount?: number;
  maxCount?: number;
  includeAssetIds?: boolean;
  includeImagePrompt?: boolean;
}) {
  const exactCount =
    typeof args.count === 'number' && Number.isFinite(args.count) ? Math.max(1, args.count) : null;
  const minCount = exactCount ?? Math.max(1, args.minCount || 1);
  const maxCount = exactCount ?? Math.max(minCount, args.maxCount || minCount);

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      posts: {
        type: 'array',
        minItems: minCount,
        maxItems: maxCount,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            caption: { type: 'string' },
            hashtags: {
              type: 'array',
              items: { type: 'string' },
            },
            ...(args.includeAssetIds
              ? {
                  asset_ids: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                }
              : {}),
            ...(args.includeImagePrompt
              ? {
                  image_prompt: {
                    type: 'string',
                  },
                }
              : {}),
          },
          // OpenAI strict json_schema requires every property key to appear in `required`.
          // Keep formerly-optional fields representable by allowing empty arrays.
          required: [
            'caption',
            'hashtags',
            ...(args.includeAssetIds ? ['asset_ids'] : []),
            ...(args.includeImagePrompt ? ['image_prompt'] : []),
          ],
        },
      },
    },
    required: ['posts'],
  };
}

function makeLlmPlanStep(args: {
  name: string;
  outputKey: string;
  schemaName: string;
  prompt: string;
  input?: Record<string, unknown>;
  count?: number;
  minCount?: number;
  maxCount?: number;
  includeAssetIds?: boolean;
  includeImagePrompt?: boolean;
}) {
  return {
    type: 'llm' as const,
    name: args.name,
    output_key: args.outputKey,
    ...(args.input ? { input: args.input } : {}),
    structured_output: {
      name: args.schemaName,
      strict: true,
      schema: makePostsStructuredOutputSchema({
        count: args.count,
        minCount: args.minCount,
        maxCount: args.maxCount,
        includeAssetIds: args.includeAssetIds,
        includeImagePrompt: args.includeImagePrompt,
      }),
    },
    prompt: args.prompt,
  };
}

function makeContentCreateStep(args: {
  name: string;
  seriesName: string;
  seriesDescription?: string;
  postsPath?: string;
  postingTime?: string;
  strategy?: 'after_last_scheduled' | 'start_date';
  startDatePath?: string;
}) {
  return {
    type: 'content_create' as const,
    name: args.name,
    output_key: 'created_content_json',
    input: {
      posts: args.postsPath || '{{plan.posts}}',
      series_name: args.seriesName,
      ...(args.seriesDescription ? { series_description: args.seriesDescription } : {}),
      posting_time: args.postingTime || '09:00',
      strategy: args.strategy || 'after_last_scheduled',
      ...(args.startDatePath ? { start_date: args.startDatePath } : {}),
      max_posts: '{{input.rolling_post_limit}}',
      content_series_id: '{{input.content_series_id}}',
      target_social_account_id: '{{input.target_social_account_id}}',
    },
  };
}

const CURATED_RECIPES: CuratedRecipeSeed[] = [
  {
    slug: '14-day-starter-pipeline',
    name: '14-Day Starter Pipeline',
    description:
      'Generate and schedule a 14-day starter content sequence tailored to your audience and offer.',
    category: 'get_started',
    config: RecipeConfigSchema.parse({
      summary: { produces: '14 scheduled drafts', postsCount: 14, cadence: 'daily' },
      inputs: buildInputs([
        {
          key: 'brand_offer',
          type: 'textarea',
          label: 'Brand offer',
          placeholder: 'What do you sell and why does it matter?',
          required: true,
        },
        {
          key: 'audience',
          type: 'input',
          label: 'Audience',
          placeholder: 'Who is this for?',
          required: true,
        },
        {
          key: 'content_pillars',
          type: 'textarea',
          label: 'Content pillars',
          placeholder: '3-5 pillars (comma-separated)',
          required: true,
        },
        {
          key: 'cta',
          type: 'input',
          label: 'Primary CTA',
          placeholder: 'What should people do next?',
          required: false,
        },
        {
          key: 'reference_assets',
          type: 'asset_reference_selector',
          label: 'Reference assets',
          description: 'Optional visual references for tone and style.',
          multiple: true,
          max: 12,
          required: false,
        },
      ]),
      cadence: { count: 14, policy: 'daily', postingTime: '09:00' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Plan starter pipeline',
          outputKey: 'plan',
          schemaName: 'starter_14_day_plan',
          count: 14,
          prompt: [
            'You are a social strategist creating a 14-day starter content plan.',
            'Return exactly 14 posts.',
            'Each post requires caption. Optional hashtags.',
            '',
            'BRAND OFFER:',
            '{{input.brand_offer}}',
            '',
            'AUDIENCE:',
            '{{input.audience}}',
            '',
            'CONTENT PILLARS:',
            '{{input.content_pillars}}',
            '',
            'CTA (optional):',
            '{{input.cta}}',
            '',
            'REFERENCE ASSET IDS (optional context only):',
            '{{input.reference_assets}}',
          ].join('\\n'),
        }),
        makeContentCreateStep({
          name: 'Create starter drafts',
          seriesName: '14-Day Starter: {{input.brand_offer}}',
          seriesDescription: '14-day starter pipeline generated by recipe',
        }),
      ],
    }),
  },
  {
    slug: 'weekly-content-batch-7-posts',
    name: 'Weekly Content Batch (7 posts)',
    description: 'Create and schedule 7 posts for next week around a single campaign theme.',
    category: 'content',
    config: RecipeConfigSchema.parse({
      summary: { produces: '7 scheduled drafts', postsCount: 7, cadence: 'daily' },
      inputs: buildInputs([
        {
          key: 'weekly_theme',
          type: 'textarea',
          label: 'Weekly theme',
          required: true,
          placeholder: 'What is this week focused on?',
        },
        {
          key: 'promotions',
          type: 'textarea',
          label: 'Promotions',
          required: false,
          placeholder: 'Offers, launches, or events this week',
        },
        {
          key: 'constraints',
          type: 'textarea',
          label: 'Constraints',
          required: false,
          placeholder: 'Words to avoid, compliance notes, etc.',
        },
        {
          key: 'asset_ids',
          type: 'asset_picker',
          label: 'Assets (optional)',
          required: false,
          multiple: true,
          max: 30,
          description: 'Optional assets to reference while planning posts.',
        },
      ]),
      cadence: { count: 7, policy: 'use_brand_schedule' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Build weekly plan',
          outputKey: 'plan',
          schemaName: 'weekly_batch_7_posts',
          count: 7,
          prompt: [
            'Create a practical 7-post weekly batch for Instagram.',
            'Return exactly 7 posts with clear variety across the week.',
            '',
            'THEME:',
            '{{input.weekly_theme}}',
            '',
            'PROMOTIONS (optional):',
            '{{input.promotions}}',
            '',
            'CONSTRAINTS (optional):',
            '{{input.constraints}}',
            '',
            'ASSET IDS (optional reference):',
            '{{input.asset_ids}}',
          ].join('\\n'),
        }),
        makeContentCreateStep({
          name: 'Create weekly drafts',
          seriesName: 'Weekly Batch: {{input.weekly_theme}}',
          seriesDescription: '7-post weekly batch generated by recipe',
        }),
      ],
    }),
  },
  {
    slug: 'album-to-highlights-series',
    name: 'Album to Highlights Series',
    description:
      'Use selected assets to generate and schedule a highlights series from a trip, event, or album.',
    category: 'content',
    config: RecipeConfigSchema.parse({
      summary: { produces: '7 scheduled drafts', postsCount: 7, cadence: 'daily' },
      inputs: buildInputs([
        {
          key: 'album_name',
          type: 'input',
          label: 'Album name',
          required: true,
          placeholder: 'Trip to Lisbon, Product shoot, etc.',
        },
        {
          key: 'album_story',
          type: 'textarea',
          label: 'Album story',
          required: false,
          placeholder: 'What happened and what should be highlighted?',
        },
        {
          key: 'tone',
          type: 'select',
          label: 'Tone',
          required: false,
          options: ['Friendly', 'Reflective', 'Premium', 'Playful'],
        },
        {
          key: 'asset_ids',
          type: 'asset_picker',
          label: 'Album assets',
          required: true,
          multiple: true,
          max: 50,
          description: 'Select the assets that should drive this highlights series.',
        },
      ]),
      cadence: { count: 7, policy: 'use_brand_schedule' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Draft highlight captions',
          outputKey: 'plan',
          schemaName: 'album_highlights_plan',
          count: 7,
          includeAssetIds: true,
          prompt: [
            'Create a 7-post highlights series from selected assets.',
            'Return exactly 7 posts.',
            'Each post needs caption. Optional hashtags. Optional asset_ids.',
            'If asset_ids are set, use only IDs from the provided list.',
            '',
            'ALBUM NAME:',
            '{{input.album_name}}',
            '',
            'ALBUM STORY (optional):',
            '{{input.album_story}}',
            '',
            'TONE (optional):',
            '{{input.tone}}',
            '',
            'AVAILABLE ASSET IDS:',
            '{{input.asset_ids}}',
          ].join('\\n'),
        }),
        makeContentCreateStep({
          name: 'Create highlight drafts',
          seriesName: 'Highlights: {{input.album_name}}',
          seriesDescription: 'Highlights series generated from selected assets',
        }),
      ],
    }),
  },
  {
    slug: 'url-article-to-5-post-series',
    name: 'URL/Article to 5-Post Series',
    description: 'Fetch a URL and turn it into 5 scheduled posts with a clear angle and CTA.',
    category: 'content',
    config: RecipeConfigSchema.parse({
      summary: { produces: '5 scheduled drafts', postsCount: 5, cadence: 'daily' },
      inputs: buildInputs([
        {
          key: 'url',
          type: 'input',
          label: 'Article URL',
          required: true,
          placeholder: 'https://example.com/article',
        },
        {
          key: 'angle',
          type: 'input',
          label: 'Angle',
          required: true,
          placeholder: 'What perspective should we take?',
        },
        {
          key: 'cta',
          type: 'input',
          label: 'CTA',
          required: false,
        },
        {
          key: 'disclaimer',
          type: 'textarea',
          label: 'Disclaimer (optional)',
          required: false,
        },
      ]),
      cadence: { count: 5, policy: 'use_brand_schedule' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'web_fetch' }, { id: 'text_generation' }],
      steps: [
        {
          type: 'skill_call',
          name: 'Fetch article text',
          skill: 'web_fetch',
          output_key: 'source_text',
          input: {
            url: '{{input.url}}',
          },
        },
        makeLlmPlanStep({
          name: 'Build article series',
          outputKey: 'plan',
          schemaName: 'article_5_post_series',
          count: 5,
          prompt: [
            'Create a 5-post social series from fetched article content.',
            'Return exactly 5 posts with distinct angles.',
            '',
            'URL:',
            '{{input.url}}',
            '',
            'ANGLE:',
            '{{input.angle}}',
            '',
            'CTA (optional):',
            '{{input.cta}}',
            '',
            'DISCLAIMER (optional):',
            '{{input.disclaimer}}',
            '',
            'FETCHED ARTICLE TEXT:',
            '{{source_text}}',
          ].join('\\n'),
        }),
        makeContentCreateStep({
          name: 'Create article drafts',
          seriesName: 'Article Series: {{input.angle}}',
          seriesDescription: '5-post article-derived series generated by recipe',
        }),
      ],
    }),
  },
  {
    slug: 'product-feature-launch-7-day-sequence',
    name: 'Product/Feature Launch (7-day sequence)',
    description:
      'Generate a 7-day launch sequence (teaser to last call) around product benefits and offer.',
    category: 'growth',
    config: RecipeConfigSchema.parse({
      summary: { produces: '7 scheduled drafts', postsCount: 7, cadence: 'daily' },
      inputs: buildInputs([
        {
          key: 'product_name',
          type: 'input',
          label: 'Product/Feature',
          required: true,
        },
        {
          key: 'benefits',
          type: 'textarea',
          label: 'Key benefits',
          required: true,
        },
        {
          key: 'offer',
          type: 'input',
          label: 'Offer',
          required: false,
        },
        {
          key: 'launch_date',
          type: 'date',
          label: 'Launch date',
          required: true,
        },
        {
          key: 'reference_assets',
          type: 'asset_reference_selector',
          label: 'Reference assets',
          required: false,
          multiple: true,
          max: 12,
        },
      ]),
      cadence: { count: 7, policy: 'daily', postingTime: '09:00' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Create launch sequence',
          outputKey: 'plan',
          schemaName: 'launch_7_day_sequence',
          count: 7,
          prompt: [
            'Create a 7-day launch sequence: teaser, problem, solution, proof, objections, offer, last call.',
            'Return exactly 7 posts.',
            '',
            'PRODUCT/FEATURE:',
            '{{input.product_name}}',
            '',
            'BENEFITS:',
            '{{input.benefits}}',
            '',
            'OFFER (optional):',
            '{{input.offer}}',
            '',
            'LAUNCH DATE:',
            '{{input.launch_date}}',
            '',
            'REFERENCE ASSETS (optional context):',
            '{{input.reference_assets}}',
          ].join('\\n'),
        }),
        makeContentCreateStep({
          name: 'Create launch drafts',
          seriesName: 'Launch: {{input.product_name}}',
          seriesDescription: '7-day launch sequence generated by recipe',
          strategy: 'start_date',
          startDatePath: '{{input.launch_date}}',
        }),
      ],
    }),
  },
  {
    slug: 'event-promo-reminders-pack',
    name: 'Event Promo + Reminders Pack',
    description:
      'Generate event announcement, reminders, and recap-style posts around a single event date.',
    category: 'growth',
    config: RecipeConfigSchema.parse({
      summary: { produces: '6 scheduled drafts', postsCount: 6, cadence: 'daily' },
      inputs: buildInputs([
        {
          key: 'event_name',
          type: 'input',
          label: 'Event name',
          required: true,
        },
        {
          key: 'event_date',
          type: 'date',
          label: 'Event date',
          required: true,
        },
        {
          key: 'agenda',
          type: 'textarea',
          label: 'Agenda/highlights',
          required: false,
        },
        {
          key: 'link',
          type: 'input',
          label: 'Registration link',
          required: true,
        },
        {
          key: 'asset_ids',
          type: 'asset_picker',
          label: 'Event assets',
          required: false,
          multiple: true,
          max: 24,
        },
      ]),
      cadence: { count: 6, policy: 'daily', postingTime: '09:00' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Plan event promo posts',
          outputKey: 'plan',
          schemaName: 'event_promo_pack',
          count: 6,
          prompt: [
            'Create a 6-post event promo pack including announcement, key points, reminders, and recap follow-up.',
            'Return exactly 6 posts.',
            '',
            'EVENT:',
            '{{input.event_name}}',
            '',
            'EVENT DATE:',
            '{{input.event_date}}',
            '',
            'AGENDA/HIGHLIGHTS (optional):',
            '{{input.agenda}}',
            '',
            'REGISTRATION LINK:',
            '{{input.link}}',
            '',
            'ASSET IDS (optional context):',
            '{{input.asset_ids}}',
          ].join('\\n'),
        }),
        makeContentCreateStep({
          name: 'Create event drafts',
          seriesName: 'Event: {{input.event_name}}',
          seriesDescription: 'Event promo pack generated by recipe',
          strategy: 'start_date',
          startDatePath: '{{input.event_date}}',
        }),
      ],
    }),
  },
  {
    slug: 'testimonials-to-carousel-series',
    name: 'Testimonials to Carousel Series',
    description: 'Turn customer testimonials into a 3-post social proof carousel series.',
    category: 'growth',
    config: RecipeConfigSchema.parse({
      summary: { produces: '3 scheduled drafts', postsCount: 3, cadence: 'use_brand_schedule' },
      inputs: buildInputs([
        {
          key: 'testimonials',
          type: 'textarea',
          label: 'Testimonials',
          required: true,
          placeholder: 'Paste testimonials, reviews, or quotes',
        },
        {
          key: 'proof_assets',
          type: 'asset_picker',
          label: 'Proof assets (optional)',
          required: false,
          multiple: true,
          max: 15,
        },
      ]),
      cadence: { count: 3, policy: 'use_brand_schedule' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Build testimonial carousel captions',
          outputKey: 'plan',
          schemaName: 'testimonial_carousel_3_posts',
          count: 3,
          includeAssetIds: true,
          prompt: [
            'Create a 3-post testimonial carousel series from provided social proof.',
            'Return exactly 3 posts.',
            'Each post should sound authentic and specific.',
            'Optional asset_ids can be used from provided proof assets.',
            '',
            'TESTIMONIALS:',
            '{{input.testimonials}}',
            '',
            'PROOF ASSET IDS (optional):',
            '{{input.proof_assets}}',
          ].join('\\n'),
        }),
        makeContentCreateStep({
          name: 'Create testimonial drafts',
          seriesName: 'Testimonials Series',
          seriesDescription: '3-post testimonial carousel sequence',
        }),
      ],
    }),
  },
  {
    slug: 'faq-to-myth-fact-series',
    name: 'FAQ to Myth/Fact Series',
    description: 'Transform common FAQs into a 10-post myth vs fact educational series.',
    category: 'social',
    config: RecipeConfigSchema.parse({
      summary: { produces: '10 scheduled drafts', postsCount: 10, cadence: 'daily' },
      inputs: buildInputs([
        {
          key: 'faqs',
          type: 'textarea',
          label: 'FAQs',
          required: true,
          placeholder: 'List customer questions and objections',
        },
        {
          key: 'audience',
          type: 'input',
          label: 'Audience',
          required: false,
        },
      ]),
      cadence: { count: 10, policy: 'daily', postingTime: '09:00' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Build myth/fact series',
          outputKey: 'plan',
          schemaName: 'faq_myth_fact_10_posts',
          count: 10,
          prompt: [
            'Create a 10-post myth vs fact educational series from FAQs.',
            'Return exactly 10 posts.',
            '',
            'FAQ LIST:',
            '{{input.faqs}}',
            '',
            'AUDIENCE (optional):',
            '{{input.audience}}',
          ].join('\\n'),
        }),
        makeContentCreateStep({
          name: 'Create myth/fact drafts',
          seriesName: 'FAQ Myth/Fact Series',
          seriesDescription: '10-post FAQ myth/fact sequence generated by recipe',
        }),
      ],
    }),
  },
  {
    slug: 'behind-the-scenes-weekly-series',
    name: 'Behind-the-Scenes Weekly Series',
    description: 'Generate a week of behind-the-scenes posts to build trust and connection.',
    category: 'social',
    config: RecipeConfigSchema.parse({
      summary: { produces: '7 scheduled drafts', postsCount: 7, cadence: 'use_brand_schedule' },
      inputs: buildInputs([
        {
          key: 'business_area',
          type: 'input',
          label: 'Business area',
          required: true,
          placeholder: 'Studio, kitchen, warehouse, team ops, etc.',
        },
        {
          key: 'team_story',
          type: 'textarea',
          label: 'Team/process story',
          required: false,
        },
        {
          key: 'voice',
          type: 'select',
          label: 'Voice',
          required: false,
          options: ['Friendly', 'Professional', 'Raw', 'Playful'],
        },
      ]),
      cadence: { count: 7, policy: 'use_brand_schedule' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Plan BTS series',
          outputKey: 'plan',
          schemaName: 'bts_weekly_7_posts',
          count: 7,
          prompt: [
            'Create a 7-post behind-the-scenes series for a brand.',
            'Return exactly 7 posts showing process, people, and authenticity.',
            '',
            'BUSINESS AREA:',
            '{{input.business_area}}',
            '',
            'TEAM/PROCESS STORY (optional):',
            '{{input.team_story}}',
            '',
            'VOICE (optional):',
            '{{input.voice}}',
          ].join('\\n'),
        }),
        makeContentCreateStep({
          name: 'Create BTS drafts',
          seriesName: 'Behind the Scenes: {{input.business_area}}',
          seriesDescription: 'Behind-the-scenes weekly series',
        }),
      ],
    }),
  },
  {
    slug: 'video-transcript-to-reels-pack',
    name: 'Video/Transcript to Reels Pack (3)',
    description:
      'Convert a transcript into 3 short-form post drafts for reels-style storytelling (text-only output).',
    category: 'social',
    config: RecipeConfigSchema.parse({
      summary: { produces: '3 scheduled drafts', postsCount: 3, cadence: 'use_brand_schedule' },
      inputs: buildInputs([
        {
          key: 'transcript',
          type: 'textarea',
          label: 'Transcript',
          required: true,
          placeholder: 'Paste transcript text',
        },
        {
          key: 'objective',
          type: 'input',
          label: 'Objective',
          required: true,
          placeholder: 'Views, saves, click-throughs, etc.',
        },
        {
          key: 'hook_style',
          type: 'select',
          label: 'Hook style',
          required: false,
          options: ['Bold', 'Curiosity', 'Educational', 'Story'],
        },
      ]),
      cadence: { count: 3, policy: 'use_brand_schedule' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Create reels-style drafts',
          outputKey: 'plan',
          schemaName: 'reels_pack_3_posts',
          count: 3,
          prompt: [
            'Create 3 reels-style social drafts from transcript content.',
            'P0 constraint: text-only output, no video generation.',
            'Return exactly 3 posts.',
            '',
            'TRANSCRIPT:',
            '{{input.transcript}}',
            '',
            'OBJECTIVE:',
            '{{input.objective}}',
            '',
            'HOOK STYLE (optional):',
            '{{input.hook_style}}',
          ].join('\\n'),
        }),
        makeContentCreateStep({
          name: 'Create reels-pack drafts',
          seriesName: 'Reels Pack: {{input.objective}}',
          seriesDescription: 'Transcript-to-reels text pack',
        }),
      ],
    }),
  },
  {
    slug: 'newsletter-to-social-calendar',
    name: 'Newsletter to Social Calendar (8-12)',
    description: 'Turn newsletter content into a social posting calendar with 8 to 12 posts.',
    category: 'content',
    config: RecipeConfigSchema.parse({
      summary: { produces: '8-12 scheduled drafts', postsCount: 10, cadence: 'use_brand_schedule' },
      inputs: buildInputs([
        {
          key: 'newsletter_text',
          type: 'textarea',
          label: 'Newsletter text',
          required: true,
        },
        {
          key: 'focus_topics',
          type: 'textarea',
          label: 'Focus topics',
          required: false,
        },
        {
          key: 'post_count',
          type: 'select',
          label: 'Post count',
          required: true,
          default: '10',
          options: [
            { label: '8 posts', value: '8' },
            { label: '10 posts', value: '10' },
            { label: '12 posts', value: '12' },
          ],
        },
      ]),
      cadence: { count: 10, policy: 'use_brand_schedule' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Build newsletter-derived calendar',
          outputKey: 'plan',
          schemaName: 'newsletter_social_calendar',
          minCount: 8,
          maxCount: 12,
          prompt: [
            'Create a social calendar from newsletter content.',
            'Return between 8 and 12 posts, aiming for the requested post_count.',
            '',
            'TARGET POST COUNT:',
            '{{input.post_count}}',
            '',
            'NEWSLETTER:',
            '{{input.newsletter_text}}',
            '',
            'FOCUS TOPICS (optional):',
            '{{input.focus_topics}}',
          ].join('\\n'),
        }),
        makeContentCreateStep({
          name: 'Create newsletter calendar drafts',
          seriesName: 'Newsletter Calendar',
          seriesDescription: 'Newsletter-derived social calendar',
        }),
      ],
    }),
  },
  {
    slug: 'local-business-30-day-calendar',
    name: 'Local Business: 30-Day Calendar',
    description:
      'Generate a full 30-day local-business content calendar with promotions and community hooks.',
    category: 'other',
    config: RecipeConfigSchema.parse({
      summary: { produces: '30 scheduled drafts', postsCount: 30, cadence: 'daily' },
      inputs: buildInputs([
        {
          key: 'business_type',
          type: 'input',
          label: 'Business type',
          required: true,
          placeholder: 'Bakery, gym, salon, dental clinic, etc.',
        },
        {
          key: 'location',
          type: 'input',
          label: 'Location',
          required: true,
        },
        {
          key: 'offers',
          type: 'textarea',
          label: 'Offers and promos',
          required: false,
        },
        {
          key: 'seasonal_events',
          type: 'textarea',
          label: 'Seasonal events',
          required: false,
        },
        {
          key: 'asset_ids',
          type: 'asset_picker',
          label: 'Photo assets (optional)',
          required: false,
          multiple: true,
          max: 60,
        },
      ]),
      cadence: { count: 30, policy: 'daily', postingTime: '09:00' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Build local 30-day calendar',
          outputKey: 'plan',
          schemaName: 'local_business_30_day_calendar',
          count: 30,
          prompt: [
            'Create a 30-day local-business social calendar.',
            'Return exactly 30 posts with varied objectives (awareness, trust, conversion).',
            '',
            'BUSINESS TYPE:',
            '{{input.business_type}}',
            '',
            'LOCATION:',
            '{{input.location}}',
            '',
            'OFFERS (optional):',
            '{{input.offers}}',
            '',
            'SEASONAL EVENTS (optional):',
            '{{input.seasonal_events}}',
            '',
            'ASSET IDS (optional context):',
            '{{input.asset_ids}}',
          ].join('\\n'),
        }),
        makeContentCreateStep({
          name: 'Create 30-day drafts',
          seriesName: '30-Day Local Calendar: {{input.business_type}}',
          seriesDescription: '30-day local-business posting calendar',
        }),
      ],
    }),
  },
  {
    slug: 'product-visual-story-pack-5',
    name: 'Product Visual Story Pack (5)',
    description:
      'Generate 5 product-focused posts with matching AI-generated images, then schedule them as drafts.',
    category: 'growth',
    config: RecipeConfigSchema.parse({
      summary: { produces: '5 scheduled drafts with AI images', postsCount: 5, cadence: 'daily' },
      inputs: buildInputs([
        {
          key: 'product_name',
          type: 'input',
          label: 'Product name',
          required: true,
          placeholder: 'What product are we highlighting?',
        },
        {
          key: 'value_props',
          type: 'textarea',
          label: 'Value props',
          required: true,
          placeholder: 'Top benefits or differentiators',
        },
        {
          key: 'visual_style',
          type: 'select',
          label: 'Visual style',
          required: false,
          options: ['Editorial', 'Studio', 'Lifestyle', 'Minimal'],
        },
        {
          key: 'image_size',
          type: 'select',
          label: 'Image size',
          required: false,
          default: '1024x1024',
          options: ['1024x1024', '1792x1024', '1024x1792'],
        },
        {
          key: 'image_quality',
          type: 'select',
          label: 'Image quality',
          required: false,
          default: 'auto',
          options: ['auto', 'low', 'medium', 'high'],
        },
      ]),
      cadence: { count: 5, policy: 'daily', postingTime: '09:00' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }, { id: 'image_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Plan product visual posts',
          outputKey: 'plan',
          schemaName: 'product_visual_story_pack_5',
          count: 5,
          includeImagePrompt: true,
          prompt: [
            'Create a 5-post product storytelling sequence.',
            'Return exactly 5 posts.',
            'Each post must include caption, hashtags array, and image_prompt.',
            '',
            'PRODUCT:',
            '{{input.product_name}}',
            '',
            'VALUE PROPS:',
            '{{input.value_props}}',
            '',
            'VISUAL STYLE (optional):',
            '{{input.visual_style}}',
          ].join('\\n'),
        }),
        {
          type: 'foreach',
          name: 'Generate product visuals',
          items: '{{plan.posts}}',
          item_key: 'post',
          output_key: 'posts_with_images',
          do: [
            {
              type: 'skill_call',
              name: 'Generate image',
              skill: 'image_generation',
              output_key: 'generated_image',
              input: {
                prompt: '{{post.image_prompt}}',
                size: '{{input.image_size}}',
                quality: '{{input.image_quality}}',
              },
            },
            {
              type: 'transform',
              name: 'Capture caption',
              output_key: 'caption',
              input: '{{post.caption}}',
            },
            {
              type: 'transform',
              name: 'Capture hashtags',
              output_key: 'hashtags',
              input: '{{post.hashtags}}',
            },
            {
              type: 'transform',
              name: 'Attach generated image',
              output_key: 'asset_ids',
              input: ['{{generated_image.assetId}}'],
            },
          ],
        },
        makeContentCreateStep({
          name: 'Create product visual drafts',
          seriesName: 'Product Visual Story: {{input.product_name}}',
          seriesDescription: '5-post product story with generated visuals',
          postsPath: '{{posts_with_images}}',
        }),
      ],
    }),
  },
  {
    slug: 'tips-to-illustrated-series-7',
    name: 'Tips to Illustrated Series (7)',
    description:
      'Turn a topic into 7 educational posts with AI-generated supporting visuals for each tip.',
    category: 'content',
    config: RecipeConfigSchema.parse({
      summary: { produces: '7 scheduled drafts with AI images', postsCount: 7, cadence: 'daily' },
      inputs: buildInputs([
        {
          key: 'topic',
          type: 'input',
          label: 'Topic',
          required: true,
          placeholder: 'What should the series teach?',
        },
        {
          key: 'audience',
          type: 'input',
          label: 'Audience',
          required: false,
        },
        {
          key: 'tone',
          type: 'select',
          label: 'Tone',
          required: false,
          options: ['Educational', 'Friendly', 'Expert', 'Playful'],
        },
        {
          key: 'image_size',
          type: 'select',
          label: 'Image size',
          required: false,
          default: '1024x1024',
          options: ['1024x1024', '1792x1024', '1024x1792'],
        },
      ]),
      cadence: { count: 7, policy: 'daily', postingTime: '09:00' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }, { id: 'image_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Plan illustrated tips',
          outputKey: 'plan',
          schemaName: 'illustrated_tips_series_7',
          count: 7,
          includeImagePrompt: true,
          prompt: [
            'Create a 7-post educational tips series.',
            'Return exactly 7 posts.',
            'Each post must include caption, hashtags array, and image_prompt.',
            '',
            'TOPIC:',
            '{{input.topic}}',
            '',
            'AUDIENCE (optional):',
            '{{input.audience}}',
            '',
            'TONE (optional):',
            '{{input.tone}}',
          ].join('\\n'),
        }),
        {
          type: 'foreach',
          name: 'Generate tip visuals',
          items: '{{plan.posts}}',
          item_key: 'post',
          output_key: 'posts_with_images',
          do: [
            {
              type: 'skill_call',
              name: 'Generate image',
              skill: 'image_generation',
              output_key: 'generated_image',
              input: {
                prompt: '{{post.image_prompt}}',
                size: '{{input.image_size}}',
              },
            },
            {
              type: 'transform',
              name: 'Capture caption',
              output_key: 'caption',
              input: '{{post.caption}}',
            },
            {
              type: 'transform',
              name: 'Capture hashtags',
              output_key: 'hashtags',
              input: '{{post.hashtags}}',
            },
            {
              type: 'transform',
              name: 'Attach generated image',
              output_key: 'asset_ids',
              input: ['{{generated_image.assetId}}'],
            },
          ],
        },
        makeContentCreateStep({
          name: 'Create illustrated drafts',
          seriesName: 'Illustrated Tips: {{input.topic}}',
          seriesDescription: '7 educational posts with generated visuals',
          postsPath: '{{posts_with_images}}',
        }),
      ],
    }),
  },
  {
    slug: 'offer-campaign-image-burst-4',
    name: 'Offer Campaign Image Burst (4)',
    description:
      'Create a 4-post offer burst with AI-generated campaign visuals designed for conversion.',
    category: 'growth',
    config: RecipeConfigSchema.parse({
      summary: { produces: '4 scheduled drafts with AI images', postsCount: 4, cadence: 'daily' },
      inputs: buildInputs([
        {
          key: 'offer_name',
          type: 'input',
          label: 'Offer name',
          required: true,
          placeholder: 'Name of the promotion or campaign',
        },
        {
          key: 'offer_details',
          type: 'textarea',
          label: 'Offer details',
          required: true,
          placeholder: 'What, for whom, and why now?',
        },
        {
          key: 'deadline',
          type: 'date',
          label: 'Deadline',
          required: false,
        },
        {
          key: 'image_quality',
          type: 'select',
          label: 'Image quality',
          required: false,
          default: 'auto',
          options: ['auto', 'low', 'medium', 'high'],
        },
      ]),
      cadence: { count: 4, policy: 'daily', postingTime: '09:00' },
      model_preset: { provider: 'openai', temperature: 0 },
      skills_required: [{ id: 'text_generation' }, { id: 'image_generation' }],
      steps: [
        makeLlmPlanStep({
          name: 'Plan offer burst',
          outputKey: 'plan',
          schemaName: 'offer_campaign_image_burst_4',
          count: 4,
          includeImagePrompt: true,
          prompt: [
            'Create a 4-post promotional burst.',
            'Sequence should progress: awareness, value, urgency, final call.',
            'Return exactly 4 posts with caption, hashtags array, and image_prompt.',
            '',
            'OFFER NAME:',
            '{{input.offer_name}}',
            '',
            'OFFER DETAILS:',
            '{{input.offer_details}}',
            '',
            'DEADLINE (optional):',
            '{{input.deadline}}',
          ].join('\\n'),
        }),
        {
          type: 'foreach',
          name: 'Generate campaign visuals',
          items: '{{plan.posts}}',
          item_key: 'post',
          output_key: 'posts_with_images',
          do: [
            {
              type: 'skill_call',
              name: 'Generate image',
              skill: 'image_generation',
              output_key: 'generated_image',
              input: {
                prompt: '{{post.image_prompt}}',
                quality: '{{input.image_quality}}',
              },
            },
            {
              type: 'transform',
              name: 'Capture caption',
              output_key: 'caption',
              input: '{{post.caption}}',
            },
            {
              type: 'transform',
              name: 'Capture hashtags',
              output_key: 'hashtags',
              input: '{{post.hashtags}}',
            },
            {
              type: 'transform',
              name: 'Attach generated image',
              output_key: 'asset_ids',
              input: ['{{generated_image.assetId}}'],
            },
          ],
        },
        makeContentCreateStep({
          name: 'Create offer drafts',
          seriesName: 'Offer Burst: {{input.offer_name}}',
          seriesDescription: '4-post promotional burst with generated visuals',
          postsPath: '{{posts_with_images}}',
        }),
      ],
    }),
  },
];

function assertCuratedRecipePack(recipes: CuratedRecipeSeed[]) {
  if (recipes.length < MIN_CURATED_RECIPE_COUNT) {
    throw new Error(
      `Curated recipe seed pack is too small (${recipes.length}); expected at least ${MIN_CURATED_RECIPE_COUNT}`
    );
  }

  const duplicateSlugs = recipes
    .map((recipe) => recipe.slug)
    .filter((slug, index, all) => all.indexOf(slug) !== index);
  if (duplicateSlugs.length > 0) {
    throw new Error(
      `Curated recipe seed pack has duplicate slugs: ${Array.from(new Set(duplicateSlugs)).join(', ')}`
    );
  }

  const assetPickerRecipeCount = recipes.filter((recipe) => {
    const typedInputs =
      recipe.config?.inputs && typeof recipe.config.inputs === 'object'
        ? (recipe.config.inputs as Record<string, unknown>)
        : null;
    const ui = typedInputs?.ui;
    if (!Array.isArray(ui)) {
      return false;
    }

    return ui.some((field) => {
      if (!field || typeof field !== 'object') {
        return false;
      }
      return (field as Record<string, unknown>).type === 'asset_picker';
    });
  }).length;

  if (assetPickerRecipeCount < MIN_ASSET_PICKER_RECIPES) {
    throw new Error(
      `Curated recipe seed pack needs at least ${MIN_ASSET_PICKER_RECIPES} asset-picker recipes; got ${assetPickerRecipeCount}`
    );
  }
}

assertCuratedRecipePack(CURATED_RECIPES);

function stableStringify(value: unknown): string {
  if (value == null) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function curatedCatalogFingerprint() {
  const canonicalCatalog = CURATED_RECIPES.map((recipe) => ({
    slug: recipe.slug,
    name: recipe.name,
    description: recipe.description,
    category: recipe.category,
    config: recipe.config,
  }));
  const serialized = stableStringify(canonicalCatalog);
  const hash = createHash('sha256').update(serialized).digest('hex');
  return {
    version: CURATED_RECIPE_CATALOG_VERSION,
    hash,
    size: CURATED_RECIPES.length,
  };
}

export type CuratedRecipeSyncResult = {
  catalogVersion: string;
  catalogHash: string;
  catalogSize: number;
  skipped: boolean;
  archivedTemplates: number;
  createdTemplates: number;
  updatedTemplates: number;
  createdVersions: number;
  unchangedVersions: number;
};

let lastSyncedCatalogHash: string | null = null;
let syncInFlight: Promise<CuratedRecipeSyncResult> | null = null;

export function getCuratedRecipeCatalogInfo() {
  const fp = curatedCatalogFingerprint();
  return {
    catalogVersion: fp.version,
    catalogHash: fp.hash,
    catalogSize: fp.size,
  };
}

export async function ensureCuratedRecipesSeeded(opts?: {
  force?: boolean;
}): Promise<CuratedRecipeSyncResult> {
  const { force = false } = opts || {};
  const fp = curatedCatalogFingerprint();

  if (!force && lastSyncedCatalogHash === fp.hash) {
    return {
      catalogVersion: fp.version,
      catalogHash: fp.hash,
      catalogSize: fp.size,
      skipped: true,
      archivedTemplates: 0,
      createdTemplates: 0,
      updatedTemplates: 0,
      createdVersions: 0,
      unchangedVersions: 0,
    };
  }

  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = (async (): Promise<CuratedRecipeSyncResult> => {
    const lock = await acquireDistributedLock({
      key: `recipes:curated-sync:${fp.version}:${fp.hash}`,
      ttlSeconds: 180,
    });
    if (!lock.acquired) {
      return {
        catalogVersion: fp.version,
        catalogHash: fp.hash,
        catalogSize: fp.size,
        skipped: true,
        archivedTemplates: 0,
        createdTemplates: 0,
        updatedTemplates: 0,
        createdVersions: 0,
        unchangedVersions: 0,
      };
    }

    let archivedTemplates = 0;
    let createdTemplates = 0;
    let updatedTemplates = 0;
    let createdVersions = 0;
    let unchangedVersions = 0;

    try {
      const curatedSlugs = CURATED_RECIPES.map((recipe) => recipe.slug);
      const archived = await prisma.recipeTemplate.updateMany({
        where: {
          brandId: null,
          isCurated: true,
          status: { not: 'archived' },
          slug: { notIn: curatedSlugs },
        },
        data: { status: 'archived' },
      });
      archivedTemplates = archived.count;

      // Upsert curated templates and publish latest version when config changes.
      for (const recipe of CURATED_RECIPES) {
        const desiredConfig = JSON.parse(JSON.stringify(recipe.config)) as Prisma.InputJsonValue;
        const desiredSig = stableStringify(desiredConfig);

        const existingTemplate = await prisma.recipeTemplate.findFirst({
          where: { brandId: null, slug: recipe.slug, isCurated: true },
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            status: true,
            isCurated: true,
          },
        });

        const template = existingTemplate
          ? await (async () => {
              const shouldUpdate =
                existingTemplate.name !== recipe.name ||
                (existingTemplate.description || null) !== (recipe.description || null) ||
                existingTemplate.category !== recipe.category ||
                existingTemplate.status !== 'published' ||
                existingTemplate.isCurated !== true;

              if (!shouldUpdate) {
                return { id: existingTemplate.id };
              }

              updatedTemplates += 1;
              return await prisma.recipeTemplate.update({
                where: { id: existingTemplate.id },
                data: {
                  name: recipe.name,
                  description: recipe.description,
                  category: recipe.category,
                  isCurated: true,
                  status: 'published',
                },
                select: { id: true },
              });
            })()
          : await (async () => {
              createdTemplates += 1;
              return await prisma.recipeTemplate.create({
                data: {
                  brandId: null,
                  slug: recipe.slug,
                  name: recipe.name,
                  description: recipe.description,
                  category: recipe.category,
                  isCurated: true,
                  status: 'published',
                },
                select: { id: true },
              });
            })();

        const versions = await prisma.recipeTemplateVersion.findMany({
          where: { recipeTemplateId: template.id },
          orderBy: { version: 'desc' },
          select: { id: true, version: true, isPublished: true, configJson: true },
          take: 5,
        });
        const published = versions.find((v) => v.isPublished) || null;
        const publishedSig = published ? stableStringify(published.configJson) : null;

        if (!published) {
          createdVersions += 1;
          await prisma.recipeTemplateVersion.create({
            data: {
              recipeTemplateId: template.id,
              version: 1,
              configJson: desiredConfig,
              isPublished: true,
              changelog: `Curated catalog sync (${CURATED_RECIPE_CATALOG_VERSION})`,
            },
          });
          continue;
        }

        if (publishedSig === desiredSig) {
          unchangedVersions += 1;
          continue;
        }

        const nextVersion = (versions[0]?.version || published.version || 0) + 1;
        createdVersions += 1;
        await prisma.$transaction([
          prisma.recipeTemplateVersion.updateMany({
            where: { recipeTemplateId: template.id, isPublished: true },
            data: { isPublished: false },
          }),
          prisma.recipeTemplateVersion.create({
            data: {
              recipeTemplateId: template.id,
              version: nextVersion,
              configJson: desiredConfig,
              isPublished: true,
              changelog: `Curated catalog sync (${CURATED_RECIPE_CATALOG_VERSION})`,
            },
          }),
        ]);
      }

      lastSyncedCatalogHash = fp.hash;
      return {
        catalogVersion: fp.version,
        catalogHash: fp.hash,
        catalogSize: fp.size,
        skipped: false,
        archivedTemplates,
        createdTemplates,
        updatedTemplates,
        createdVersions,
        unchangedVersions,
      };
    } finally {
      await lock.release();
    }
  })();

  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}
