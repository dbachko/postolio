import type {
  SourceAdapter,
  FetchParams,
  RawSourceBatch,
  CanonicalEvent,
  AdapterHealth,
} from './types';

export class InstagramAdapter implements SourceAdapter {
  id = 'instagram';
  capabilities = { text: true, images: true, engagement: true } as const;

  async fetch(input: FetchParams): Promise<RawSourceBatch> {
    // Placeholder: In Phase 1, the API will supply normalized posts.
    // A future iteration will read from our API or a cache.
    void input;
    return { items: [] };
  }

  normalize(batch: RawSourceBatch): CanonicalEvent[] {
    // Map raw IG API payloads to CanonicalEvent
    return (batch.items || []).map((_, i) => ({
      id: `placeholder-${i}`,
      source: 'instagram',
      type: 'text-post',
      text: '',
      createdAt: new Date().toISOString(),
    }));
  }

  async health(): Promise<AdapterHealth> {
    // Basic always-ok health for skeleton
    return { ok: true };
  }
}
