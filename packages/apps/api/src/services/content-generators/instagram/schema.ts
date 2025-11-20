import type { GeneratedContent } from '../types.js';

export const instagramResponseSchema = {
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
} as const;

type StructuredResponse = {
  posts: Array<{
    caption: string;
    hashtags: string[];
    imagePrompt: string;
  }>;
};

export function parseInstagramResponse(
  rawContent: string,
  options: { expectedCount: number; brandId: string }
): GeneratedContent[] {
  const structured = JSON.parse(rawContent) as StructuredResponse;

  if (!structured.posts || !Array.isArray(structured.posts)) {
    throw new Error('Invalid response structure: missing posts array');
  }

  if (structured.posts.length === 0) {
    throw new Error('Invalid response structure: posts array is empty');
  }

  if (structured.posts.length !== options.expectedCount) {
    // Mismatch between requested and returned posts; proceed but do not spam logs in production.
  }
  const mapped = structured.posts.map((post) => ({
    caption: post.caption.trim(),
    hashtags: post.hashtags,
    imagePrompt: post.imagePrompt,
  }));
  return mapped;
}
