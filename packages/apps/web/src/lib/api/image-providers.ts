import { http } from '@/lib/api';
import type { ImageProvider } from '@/types/image-providers';

export interface ImageProviderPricing {
  standard: number;
  hd?: number;
  features: string[];
  speedEstimate: string;
}

export interface ImageProviderSummary {
  name: ImageProvider;
  displayName: string;
  isConfigured: boolean;
  pricing: ImageProviderPricing;
}

export interface ImageProvidersResponse {
  providers: ImageProviderSummary[];
  default: ImageProvider | null;
}

export async function getImageProviders(): Promise<ImageProvidersResponse> {
  return (await http('/api/image-providers')) as ImageProvidersResponse;
}
