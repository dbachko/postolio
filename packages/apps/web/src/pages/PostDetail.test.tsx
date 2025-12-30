import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageMetaProvider } from '@/contexts/PageMetaContext';
import PostPage from './post';

vi.mock('@/lib/api', () => ({
  content: {
    getPostDetail: vi.fn(),
    getPostComments: vi.fn(),
    updateContent: vi.fn(),
    updateMedia: vi.fn(),
    uploadContentImage: vi.fn(),
    schedulePost: vi.fn(),
    publishPost: vi.fn(),
    deletePost: vi.fn(),
  },
  campaign: {
    getScheduleAheadLimit: vi.fn(),
    listCampaigns: vi.fn(),
  },
  analytics: {
    getPublicationsByContent: vi.fn(),
    getPublicationLatest: vi.fn(),
    refreshPublication: vi.fn(),
  },
}));

vi.mock('@/features/assets/api/client', () => ({
  assetsApi: {
    getBatchAssets: vi.fn(),
  },
}));

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({
    timezone: 'UTC',
    getBrandTimezone: vi.fn(async () => 'UTC'),
  }),
}));

import {
  content as contentApi,
  analytics as analyticsApi,
  campaign as campaignApi,
} from '@/lib/api';
import { assetsApi } from '@/features/assets/api/client';

describe('PostDetail', () => {
  it('renders a video preview for video primary assets', async () => {
    const postId = 'post-1';
    const brandId = 'brand-1';
    const assetId = 'asset-1';

    vi.mocked(contentApi.getPostDetail).mockResolvedValue({
      data: {
        id: postId,
        caption: 'Test post',
        hashtags: [],
        contentType: 'reel',
        shareToFeed: true,
        status: 'published',
        scheduledAt: null,
        postedAt: '2025-12-08T00:00:00.000Z',
        generationParams: null,
        createdAt: '2025-12-08T00:00:00.000Z',
        updatedAt: '2025-12-08T00:00:00.000Z',
        brandId,
        campaignId: null,
        schedulingError: null,
        firstComment: null,
        firstCommentStatus: null,
        firstCommentPostedAt: null,
        firstCommentError: null,
        mediaAssets: [{ assetId, displayOrder: 0 }],
        mediaAssetCount: 1,
        primaryAssetId: assetId,
        brand: { id: brandId, name: 'Brand' },
        campaign: null,
        instagramPermalink: null,
      },
    });

    vi.mocked(analyticsApi.getPublicationsByContent).mockResolvedValue({ success: true, data: [] });
    vi.mocked(contentApi.getPostComments).mockResolvedValue({ data: { comments: [] } });
    vi.mocked(campaignApi.getScheduleAheadLimit).mockResolvedValue({
      data: { tier: 'test', maxAllowed: 10, currentCount: 0 },
    } as any);
    vi.mocked(campaignApi.listCampaigns).mockResolvedValue({ campaigns: [] } as any);

    vi.mocked(assetsApi.getBatchAssets).mockResolvedValue({
      assets: {
        [assetId]: {
          id: assetId,
          brandId,
          fileName: 'video.mp4',
          fileType: 'video',
          mimeType: 'video/mp4',
          fileSize: 123,
          s3Key: 's3/key',
          url: 'https://cdn.example/video.mp4',
          thumbnailUrl: 'https://cdn.example/video-thumb.jpg',
          tags: [],
          createdAt: '2025-12-08T00:00:00.000Z',
          updatedAt: '2025-12-08T00:00:00.000Z',
        },
      },
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <PageMetaProvider>
          <MemoryRouter initialEntries={[`/posts/${postId}`]}>
            <Routes>
              <Route path="/posts/:postId" element={<PostPage />} />
            </Routes>
          </MemoryRouter>
        </PageMetaProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      const video = container.querySelector('video');
      expect(video).not.toBeNull();
    });

    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('https://cdn.example/video.mp4');
  });
});
