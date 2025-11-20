import type { BrandProfileContext } from '../../brand-profile.js';
import type { ContentGenerationRequest, GeneratedContent } from '../types.js';

export function buildFallbackGeneratedContent(
  brandContext: Pick<BrandProfileContext, 'palette'>,
  brandName: string,
  request: ContentGenerationRequest
): GeneratedContent[] {
  const { count } = request;

  const posts = Array.from({ length: count }, (_, index) => ({
    caption: `Generated content ${
      index + 1
    } for ${brandName}. This engaging post captures the essence of your brand while connecting with your audience. Share your story and inspire your followers! 🌟`,
    hashtags: ['inspiration', 'lifestyle', 'authentic', 'community', 'brand'],
    imagePrompt: `A beautiful modern image featuring ${
      Array.isArray(brandContext.palette) && brandContext.palette.length >= 2
        ? `${brandContext.palette[0]} and ${brandContext.palette[1]}`
        : 'vibrant'
    } colors, 1:1, Instagram-ready, no text, no watermark`,
  }));

  return posts;
}
