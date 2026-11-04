/**
 * Core types for multi-provider image generation system
 */

import type { BrandProfileContext } from '../brand-profile.js';

export const IMAGE_PROVIDERS = ['dalle-3', 'gemini-2.5-flash', 'gemini-3-pro'] as const;

export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

export type ImageSize = '1024x1024' | '1792x1024' | '1024x1792' | '2048x2048' | '4096x4096';
export type ImageQuality = 'standard' | 'hd';

export type ImageFeature =
  'text-rendering' | 'multi-turn' | '4k-resolution' | 'character-consistency' | 'multimodal-input';

export interface ImageGenerationRequest {
  prompt: string;
  brandContext: BrandProfileContext | null;
  brandName: string;
  size?: ImageSize;
  quality?: ImageQuality;
}

export interface ImageGenerationResult {
  imageUrl?: string;
  imageBuffer?: Buffer;
  provider: ImageProvider;
  cost: number; // USD
  metadata: {
    model: string;
    size: string;
    quality?: string;
    generationTime: number; // milliseconds
    revisedPrompt?: string;
    assetId?: string;
  };
}

export interface ProviderPricing {
  standard: number; // Cost per image in USD
  hd?: number;
  features: string[];
  speedEstimate: string; // e.g., "5-10s"
}

export interface IImageProvider {
  readonly name: ImageProvider;
  readonly displayName: string;
  readonly isConfigured: boolean;
  readonly pricing: ProviderPricing;

  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
  healthCheck(): Promise<boolean>;
  supports(feature: ImageFeature): boolean;
}
