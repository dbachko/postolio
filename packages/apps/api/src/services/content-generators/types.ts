import type { ImageProvider } from '../image-providers/types.js';

export interface ContentGenerationRequest {
  brandId: string;
  count: number;
  theme?: string | undefined;
  style?: string | undefined;
  // Optional: link generation to a specific campaign so we can include context
  campaignId?: string | undefined;
  // Optional: specify image provider (falls back to brand or system default)
  imageProvider?: ImageProvider | undefined;
}

export interface GeneratedContent {
  caption: string;
  hashtags: string[];
  imagePrompt?: string;
  // Deferred asset import fields (OOM optimization)
  imageUrl?: string;
  imageMetadata?: {
    source: string;
    originalPrompt: string;
    assetId?: string;
  };
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
      imageModel?: string;
    };
  };
}

export type ContentGenerator = (
  brandName: string,
  request: ContentGenerationRequest
) => Promise<GeneratedContent[]>;
