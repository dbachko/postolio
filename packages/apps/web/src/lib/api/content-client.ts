import type { HttpRequest } from '../http/http';
import { convertFileToBase64 } from '@/lib/fileUtils';

export class ContentClient {
  constructor(private request: HttpRequest) {}

  // Manual content creation (accepts form-like input and handles base64 conversion)
  async createManualContent(data: {
    brandId: string;
    caption: string;
    hashtags: string[];
    imageFile?: File;
    campaignId?: string;
    scheduledAt?: string;
  }) {
    const body: Record<string, unknown> = {
      brandId: data.brandId,
      caption: data.caption,
      hashtags: data.hashtags,
    };
    if (data.campaignId) body.campaignId = data.campaignId;
    if (data.scheduledAt) body.scheduledAt = data.scheduledAt;
    if (data.imageFile) {
      const imageData = await convertFileToBase64(data.imageFile);
      body.imageData = imageData;
      body.mimeType = data.imageFile.type;
    }
    return this.request('/api/content', { method: 'POST', body: JSON.stringify(body) });
  }

  // List drafts for a brand (sorted by last modified by default)
  getDrafts(brandId: string) {
    return this.request(`/api/content/pending/${encodeURIComponent(brandId)}`);
  }

  getContentHistory(brandId: string) {
    return this.request(`/api/brands/${brandId}/content/history`);
  }

  publishToInstagram(contentId: string) {
    return this.request(`/api/content/${contentId}/publish`, { method: 'POST' });
  }

  scheduleContent(contentId: string, customTime?: string) {
    return this.request(`/api/content/${contentId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ customTime }),
    });
  }

  updateContent(data: any) {
    return this.request(`/api/content/${data.contentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async uploadContentImage(contentId: string, fileOrBase64: File | string) {
    if (typeof fileOrBase64 === 'string') {
      // If a URL string is passed, treat as no-op for upload endpoint
      // Callers typically handle setting URL directly without upload
      return {
        success: true,
        content: { id: contentId, imageUrl: fileOrBase64 },
        message: 'ok',
      } as any;
    }
    const imageData = await convertFileToBase64(fileOrBase64);
    const mimeType = fileOrBase64.type;
    return this.request('/api/content/upload-image', {
      method: 'POST',
      body: JSON.stringify({ contentId, imageData, mimeType }),
    });
  }

  deletePost(postId: string) {
    return this.request(`/api/content/${postId}`, { method: 'DELETE' });
  }

  schedulePost(postId: string, scheduledAt: string) {
    return this.request(`/api/content/${postId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduledAt }),
    });
  }

  publishPostNow(postId: string) {
    return this.request(`/api/content/${postId}/publish`, { method: 'POST' });
  }

  getCalendarContent(brandId: string, yyyymm: string) {
    return this.request(`/api/brands/${brandId}/calendar/${yyyymm}`);
  }

  getPostDetail(postId: string) {
    return this.request(`/api/posts/${postId}`);
  }

  getPostInsights(postId: string) {
    return this.request(`/api/posts/${postId}/insights`);
  }

  getPostComments(postId: string, page = 1, limit = 20) {
    return this.request(`/api/posts/${postId}/comments?page=${page}&limit=${limit}`);
  }

  publishPost(postId: string) {
    return this.request(`/api/content/${postId}/publish`, { method: 'POST' });
  }
}
