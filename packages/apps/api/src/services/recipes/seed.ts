import { Prisma } from '@postolio/database';
import { prisma } from '../../config/database.js';
import { RecipeConfigSchema, type RecipeConfig } from './config-schema.js';

type CuratedRecipeSeed = {
  slug: string;
  name: string;
  description: string;
  category: 'get_started' | 'content' | 'growth' | 'social' | 'other';
  config: RecipeConfig;
};

const CURATED_RECIPES: CuratedRecipeSeed[] = [
  {
    slug: 'quick-draft-captions',
    name: 'Quick Draft: Captions (3)',
    description: 'Generate three caption drafts from a short brief.',
    category: 'content',
    config: RecipeConfigSchema.parse({
      inputs: {
        required: ['brief'],
        optional: ['brand_voice'],
      },
      model_preset: {
        provider: 'openai',
        temperature: 0.7,
      },
      skills_required: [],
      steps: [
        {
          type: 'llm',
          name: 'Generate captions',
          input: {
            brief: '{{input.brief}}',
            brand_voice: '{{input.brand_voice}}',
          },
          prompt: [
            'You are a social media copywriter.',
            '',
            'Write 3 Instagram caption drafts for the brand described below.',
            '- Keep each caption under 2200 characters.',
            '- Use line breaks for readability.',
            '- Avoid hashtags unless asked.',
            '',
            'BRIEF:',
            '{{input.brief}}',
            '',
            'OPTIONAL BRAND VOICE:',
            '{{input.brand_voice}}',
            '',
            'Return markdown with headings: "Draft 1", "Draft 2", "Draft 3".',
          ].join('\n'),
          output_key: 'captions_md',
        },
        {
          type: 'export',
          name: 'Export captions',
          artifacts: [
            {
              kind: 'markdown',
              name: 'captions.md',
              mime_type: 'text/markdown',
              content: '{{captions_md}}',
            },
          ],
        },
      ],
    }),
  },
  {
    slug: 'url-summary-to-caption',
    name: 'URL Summary → Caption Draft',
    description: 'Fetch a URL and turn it into a caption draft.',
    category: 'content',
    config: RecipeConfigSchema.parse({
      inputs: {
        required: ['url'],
        optional: ['brief', 'brand_voice'],
      },
      model_preset: {
        provider: 'openai',
        temperature: 0.6,
      },
      skills_required: ['web_fetch'],
      steps: [
        {
          type: 'skill_call',
          name: 'Fetch URL context',
          skill: 'web_fetch',
          input: { url: '{{input.url}}' },
          output_key: 'url_context',
        },
        {
          type: 'llm',
          name: 'Write caption draft',
          input: {
            url: '{{input.url}}',
            url_context: '{{url_context}}',
            brief: '{{input.brief}}',
            brand_voice: '{{input.brand_voice}}',
          },
          prompt: [
            'You are a social media copywriter.',
            '',
            'Write 1 Instagram caption draft based on the page content summary below.',
            '- Keep it concise and engaging.',
            '- Use line breaks.',
            '- Do not invent facts; stick to the provided summary.',
            '',
            'URL:',
            '{{input.url}}',
            '',
            'PAGE SUMMARY:',
            '{{url_context}}',
            '',
            'OPTIONAL USER BRIEF:',
            '{{input.brief}}',
            '',
            'OPTIONAL BRAND VOICE:',
            '{{input.brand_voice}}',
          ].join('\n'),
          output_key: 'caption_md',
        },
        {
          type: 'export',
          name: 'Export caption',
          artifacts: [
            {
              kind: 'markdown',
              name: 'caption.md',
              mime_type: 'text/markdown',
              content: '{{caption_md}}',
            },
          ],
        },
      ],
    }),
  },
  {
    slug: 'rewrite-caption-3-tones',
    name: 'Rewrite Caption (3 tones)',
    description: 'Rewrite an existing caption into three different tones.',
    category: 'content',
    config: RecipeConfigSchema.parse({
      inputs: {
        required: ['caption'],
        optional: ['brand_voice'],
      },
      model_preset: {
        provider: 'openai',
        temperature: 0.7,
      },
      skills_required: [],
      steps: [
        {
          type: 'llm',
          name: 'Rewrite caption',
          input: {
            caption: '{{input.caption}}',
            brand_voice: '{{input.brand_voice}}',
          },
          prompt: [
            'Rewrite the caption below into 3 variants:',
            '1) Friendly and casual',
            '2) Professional and confident',
            '3) Playful and witty',
            '',
            'CAPTION:',
            '{{input.caption}}',
            '',
            'OPTIONAL BRAND VOICE:',
            '{{input.brand_voice}}',
            '',
            'Return markdown with headings: "Variant 1", "Variant 2", "Variant 3".',
          ].join('\n'),
          output_key: 'rewrites_md',
        },
        {
          type: 'export',
          name: 'Export variants',
          artifacts: [
            {
              kind: 'markdown',
              name: 'rewrites.md',
              mime_type: 'text/markdown',
              content: '{{rewrites_md}}',
            },
          ],
        },
      ],
    }),
  },
];

let didSeed = false;

export async function ensureCuratedRecipesSeeded(): Promise<void> {
  if (didSeed) return;
  didSeed = true;

  const existing = await prisma.recipeTemplate.findMany({
    where: {
      brandId: null,
      isCurated: true,
    },
    select: { slug: true },
  });

  const existingSlugs = new Set(existing.map((r) => r.slug));

  const toCreate = CURATED_RECIPES.filter((r) => !existingSlugs.has(r.slug));
  if (toCreate.length === 0) return;

  await prisma.$transaction(
    toCreate.map((r) =>
      prisma.recipeTemplate.create({
        data: {
          brandId: null,
          slug: r.slug,
          name: r.name,
          description: r.description,
          category: r.category,
          isCurated: true,
          status: 'published',
          versions: {
            create: {
              version: 1,
              configJson: JSON.parse(JSON.stringify(r.config)) as Prisma.InputJsonValue,
              isPublished: true,
            },
          },
        },
      })
    )
  );
}
