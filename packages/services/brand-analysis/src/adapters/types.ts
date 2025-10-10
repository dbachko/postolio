export interface FetchParams {
  brandId: string;
  maxPosts?: number;
  since?: string; // ISO8601
}

export interface RawSourceBatch {
  items: unknown[];
}

export interface CanonicalEvent {
  id: string;
  source: string;
  type: 'text-post' | 'image' | 'video' | 'meta';
  text?: string;
  hashtags?: string[];
  createdAt: string; // ISO8601
  mediaUrls?: string[];
  metrics?: { likes?: number; comments?: number; shares?: number; views?: number };
}

export interface AdapterHealth {
  ok: boolean;
  details?: Record<string, unknown>;
}

export interface SourceAdapter {
  id: string;
  capabilities: { text: boolean; images: boolean; engagement: boolean; rateLimitInfo?: unknown };
  fetch(input: FetchParams): Promise<RawSourceBatch>;
  normalize(batch: RawSourceBatch): CanonicalEvent[];
  health(): Promise<AdapterHealth>;
}
