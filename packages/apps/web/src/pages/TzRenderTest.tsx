import { useMemo } from 'react';
import { PostPreviewCard } from '@/components/post-preview-card/PostPreviewCard';
import type { CalendarItem } from '@/types/calendar';

/**
 * Minimal page to render a single PostPreviewCard for timezone verification in E2E.
 *
 * Usage:
 *   /__tz?iso=2025-01-16T04:31:00Z&tz=America/New_York&status=scheduled
 */
export default function TzRenderTest() {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const iso = params.get('iso') || '2025-01-16T04:31:00Z';
  const tz = params.get('tz') || 'America/New_York';
  const statusParam = params.get('status') || 'scheduled';

  const item: CalendarItem = useMemo(
    () =>
      ({
        id: 'tz-test-1',
        type: 'content',
        status: (statusParam as any) ?? 'scheduled',
        campaignId: null,
        campaignName: 'TZ Test',
        campaignColor: null,
        scheduledAt: iso,
        postedAt: null,
        caption: 'Timezone Render Test',
        hashtags: [],
        primaryAssetId: null,
        instagramPermalink: null,
        schedulingError: null,
        contentType: 'post',
        mediaAssets: [],
        mediaAssetCount: 0,
        message: '',
        brandId: 'brand-tz-test',
        createdAt: iso,
        updatedAt: iso,
      }) as any,
    [iso, statusParam]
  );

  return (
    <div style={{ padding: 16 }}>
      <div data-testid="tz-inputs" style={{ marginBottom: 8 }}>
        <div>
          Brand Timezone: <span data-testid="brand-tz">{tz}</span>
        </div>
        <div>
          ISO: <span data-testid="iso">{iso}</span>
        </div>
      </div>
      <div data-testid="tz-card">
        <PostPreviewCard item={item} timezone={tz} />
      </div>
    </div>
  );
}
