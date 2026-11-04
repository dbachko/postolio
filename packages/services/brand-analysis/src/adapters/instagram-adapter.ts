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
    // Stub: this adapter does not fetch posts.
    void input;
    return { items: [] };
  }

  normalize(batch: RawSourceBatch): CanonicalEvent[] {
    // Stub: return empty events for the supplied items.
    return (batch.items || []).map((_, i) => ({
      id: `placeholder-${i}`,
      source: 'instagram',
      type: 'text-post',
      text: '',
      createdAt: new Date().toISOString(),
    }));
  }

  async health(): Promise<AdapterHealth> {
    // Reports availability without contacting Instagram.
    return { ok: true };
  }
}
