import { prisma } from '../../config/database.js';
import { AUDIO_SKILL_DEFINITION } from './skill-definition-audio.js';
import type { SkillSeed } from './skill-seed-types.js';

const DEPRECATED_SKILL_IDS = ['openai_text', 'openai_image'] as const;

const SKILL_DEFINITIONS: SkillSeed[] = [
  {
    id: 'web_fetch',
    name: 'Web Fetch',
    description: 'Fetch a public URL and extract a safe text summary.',
    icon: null,
    modeSupported: 'managed',
    scopesJson: {
      network: true,
      provider: 'internal',
      tags: ['network', 'research', 'utility'],
      docs: 'Fetches a public URL and returns extracted text. Use this skill when a recipe needs external context.',
      docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
      examples: [
        {
          title: 'Summarize a news page',
          input: { url: 'https://example.com/article' },
        },
      ],
      try: {
        enabled: true,
        sampleInput: { url: 'https://example.com' },
      },
    },
    configSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxBytes: {
          type: 'number',
          title: 'Max Bytes',
          description: 'Maximum response bytes to fetch before truncation.',
          default: 1000000,
        },
      },
    },
  },
  {
    id: 'text_generation',
    name: 'AI Text',
    description: 'Text generation capability (Managed or BYOK).',
    icon: null,
    modeSupported: 'both',
    scopesJson: {
      llm: true,
      provider: 'openai',
      providers: ['openai'],
      tags: ['llm', 'text', 'generation'],
      docs: 'Generates text outputs for recipe steps. In BYOK mode, provider keys are encrypted and stored in brand secrets.',
      docsUrl: 'https://platform.openai.com/docs',
      examples: [
        {
          title: 'Generate a weekly content plan',
          input: { prompt: 'Create a 7-day social content plan for a coffee shop.' },
        },
      ],
      secretSchema: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string',
            title: 'Provider API Key',
            secret: true,
            placeholder: 'Enter provider key',
          },
        },
        required: ['apiKey'],
      },
      try: {
        enabled: true,
        sampleInput: { prompt: 'Write one short product launch teaser post.' },
      },
    },
    configSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {
        provider: {
          type: 'string',
          title: 'Provider',
          enum: ['openai'],
          default: 'openai',
        },
        defaultModel: {
          type: 'string',
          title: 'Default Model',
          description: 'Model used when the recipe does not specify one explicitly.',
          default: 'gpt-4o-mini',
        },
      },
    },
  },
  {
    id: 'image_generation',
    name: 'AI Image',
    description: 'Image generation capability (Managed or BYOK).',
    icon: null,
    modeSupported: 'both',
    scopesJson: {
      image: true,
      provider: 'openai',
      providers: ['openai'],
      tags: ['image', 'generation', 'creative'],
      docs: 'Generates images and returns asset references for use in content_create.',
      docsUrl: 'https://platform.openai.com/docs/guides/images',
      examples: [
        {
          title: 'Generate a hero visual',
          input: {
            prompt: 'A modern product hero shot on a soft gradient background.',
            size: '1024x1024',
            quality: 'auto',
          },
        },
      ],
      secretSchema: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string',
            title: 'Provider API Key',
            secret: true,
            placeholder: 'Enter provider key',
          },
        },
        required: ['apiKey'],
      },
      try: {
        enabled: true,
        sampleInput: {
          prompt: 'A clean product image in studio lighting.',
          size: '1024x1024',
          quality: 'auto',
        },
      },
    },
    configSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {
        provider: {
          type: 'string',
          title: 'Provider',
          enum: ['openai'],
          default: 'openai',
        },
        defaultModel: {
          type: 'string',
          title: 'Default Model',
          enum: ['gpt-image-1'],
          default: 'gpt-image-1',
        },
        defaultSize: {
          type: 'string',
          title: 'Default Image Size',
          enum: ['1024x1024', '1792x1024', '1024x1792'],
          default: '1024x1024',
        },
        defaultQuality: {
          type: 'string',
          title: 'Default Quality',
          enum: ['auto', 'low', 'medium', 'high'],
          default: 'auto',
        },
      },
    },
  },
  {
    id: 'video_gen',
    name: 'AI Video',
    description: 'Video generation capability (Managed or BYOK).',
    icon: null,
    modeSupported: 'both',
    scopesJson: {
      video: true,
      provider: 'openai',
      providers: ['openai'],
      tags: ['video', 'generation', 'creative'],
      docs: 'Generates short videos from prompts and imports them into the asset library for use in recipe outputs.',
      docsUrl: 'https://platform.openai.com/docs/guides/video',
      examples: [
        {
          title: 'Generate a promo clip',
          input: {
            prompt: 'Cinematic product reveal with dramatic lighting and quick cuts.',
            durationSeconds: 5,
            size: '1280x720',
          },
        },
      ],
      providerDetails: {
        openai: {
          label: 'OpenAI',
          docs: 'Use OpenAI video generation models to create short campaign clips from text prompts.',
          docsUrl: 'https://platform.openai.com/docs/guides/video',
          examples: [
            {
              title: '5-second product teaser',
              input: {
                prompt: 'A sleek sneaker rotating on a reflective surface with soft studio lights.',
                durationSeconds: 5,
              },
            },
          ],
          secretSchema: {
            type: 'object',
            properties: {
              apiKey: {
                type: 'string',
                title: 'Provider API Key',
                secret: true,
                placeholder: 'Enter provider key',
              },
            },
            required: ['apiKey'],
          },
          configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              provider: {
                type: 'string',
                title: 'Provider',
                enum: ['openai'],
                default: 'openai',
              },
              defaultModel: {
                type: 'string',
                title: 'Default Model',
                default: 'gpt-video-1',
              },
              defaultDurationSec: {
                type: 'number',
                title: 'Default Duration (seconds)',
                default: 5,
              },
              defaultSize: {
                type: 'string',
                title: 'Default Video Size',
                enum: ['1024x1024', '1280x720', '720x1280'],
                default: '1280x720',
              },
            },
          },
        },
      },
      secretSchema: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string',
            title: 'Provider API Key',
            secret: true,
            placeholder: 'Enter provider key',
          },
        },
        required: ['apiKey'],
      },
      try: {
        enabled: true,
        sampleInput: {
          prompt: 'A smooth cinematic pan across a product setup with soft light.',
          durationSeconds: 5,
        },
      },
    },
    configSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {
        provider: {
          type: 'string',
          title: 'Provider',
          enum: ['openai'],
          default: 'openai',
        },
        defaultModel: {
          type: 'string',
          title: 'Default Model',
          default: 'gpt-video-1',
        },
        defaultDurationSec: {
          type: 'number',
          title: 'Default Duration (seconds)',
          default: 5,
        },
        defaultSize: {
          type: 'string',
          title: 'Default Video Size',
          enum: ['1024x1024', '1280x720', '720x1280'],
          default: '1280x720',
        },
      },
    },
  },
  AUDIO_SKILL_DEFINITION,
];

let didSeed = false;

export async function ensureSkillDefinitionsSeeded(): Promise<void> {
  if (didSeed) {
    return;
  }
  didSeed = true;

  // Hard refresh: remove legacy provider-specific skills and old provider-scoped secrets.
  await prisma.skillDefinition.deleteMany({
    where: {
      id: { in: [...DEPRECATED_SKILL_IDS] },
    },
  });
  await prisma.encryptedSecret.deleteMany({
    where: {
      kind: 'openai_api_key',
    },
  });

  await prisma.$transaction(
    SKILL_DEFINITIONS.map((s) =>
      prisma.skillDefinition.upsert({
        where: { id: s.id },
        update: {
          name: s.name,
          description: s.description,
          icon: s.icon,
          modeSupported: s.modeSupported,
          scopesJson: s.scopesJson,
          configSchemaJson: s.configSchemaJson,
        },
        create: {
          id: s.id,
          name: s.name,
          description: s.description,
          icon: s.icon,
          modeSupported: s.modeSupported,
          scopesJson: s.scopesJson,
          configSchemaJson: s.configSchemaJson,
        },
      })
    )
  );
}
