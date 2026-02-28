import type { SkillSeed } from './skill-seed-types.js';

export const AUDIO_SKILL_DEFINITION: SkillSeed = {
  id: 'audio_gen',
  name: 'AI Audio',
  description: 'Audio generation capability (Managed or BYOK).',
  icon: null,
  modeSupported: 'both',
  scopesJson: {
    audio: true,
    provider: 'openai',
    providers: ['openai'],
    tags: ['audio', 'tts', 'voice'],
    docs: 'Generates speech audio from text for narration snippets and voiceover-ready recipe outputs.',
    docsUrl: 'https://platform.openai.com/docs/guides/text-to-speech',
    examples: [
      {
        title: 'Create narration audio',
        input: {
          text: 'Welcome to this week’s product update.',
          voice: 'alloy',
          format: 'mp3',
        },
      },
    ],
    providerDetails: {
      openai: {
        label: 'OpenAI',
        docs: 'Use OpenAI text-to-speech models to generate short voice clips from recipe-generated text.',
        docsUrl: 'https://platform.openai.com/docs/guides/text-to-speech',
        examples: [
          {
            title: 'Voiceover line',
            input: {
              text: 'Discover the latest release in under thirty seconds.',
              voice: 'alloy',
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
              default: 'gpt-4o-mini-tts',
            },
            defaultVoice: {
              type: 'string',
              title: 'Default Voice',
              enum: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'],
              default: 'alloy',
            },
            defaultFormat: {
              type: 'string',
              title: 'Default Format',
              enum: ['mp3', 'wav', 'pcm16'],
              default: 'mp3',
            },
            maxOutputBytes: {
              type: 'number',
              title: 'Max Output Bytes',
              default: 800000,
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
        text: 'Welcome to your weekly social content recap.',
        voice: 'alloy',
        format: 'mp3',
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
        default: 'gpt-4o-mini-tts',
      },
      defaultVoice: {
        type: 'string',
        title: 'Default Voice',
        enum: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'],
        default: 'alloy',
      },
      defaultFormat: {
        type: 'string',
        title: 'Default Format',
        enum: ['mp3', 'wav', 'pcm16'],
        default: 'mp3',
      },
      maxOutputBytes: {
        type: 'number',
        title: 'Max Output Bytes',
        default: 800000,
      },
    },
  },
};
