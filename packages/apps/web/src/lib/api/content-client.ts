import type { HttpRequest } from '../http/http';
import type { InstagramContentType } from '@postolio/content-validation';
import { assetsApi } from './assets-client';

export class ContentClient {
  constructor(private request: HttpRequest) {}

  publishToPlatform(contentId: string, platform: string, options?: { socialAccountId?: string }) {
    const body = options?.socialAccountId
      ? JSON.stringify({ socialAccountId: options.socialAccountId })
      : undefined;
    return this.request(
      `/api/social/${encodeURIComponent(platform)}/publish/${encodeURIComponent(contentId)}`,
      {
        method: 'POST',
        body,
      }
    );
  }

  publishNow(contentId: string) {
    return this.request(`/api/content/${encodeURIComponent(contentId)}/publish-now`, {
      method: 'POST',
    });
  }

  publishContentGroupNow(contentGroupId: string) {
    return this.request(`/api/content/groups/${encodeURIComponent(contentGroupId)}/publish-now`, {
      method: 'POST',
    });
  }

  // Manual content creation (accepts form-like input and handles base64 conversion)
  async createManualContent(data: {
    brandId: string;
    caption: string;
    imageFile?: File;
    assetIds?: string[]; // Array of asset IDs (single image or carousel)
    contentType?: InstagramContentType;
    scheduledAt?: string;
    shareToFeed?: boolean;
    firstComment?: string;
    targetSocialAccountIds?: string[];
    targetSocialAccountId?: string | null;
  }) {
    const body: Record<string, unknown> = {
      brandId: data.brandId,
      caption: data.caption,
    };
    if (data.scheduledAt) {
      body.scheduledAt = data.scheduledAt;
    }
    if (data.contentType) {
      body.contentType = data.contentType;
    }
    if (data.assetIds) {
      body.assetIds = data.assetIds;
    }
    if (data.shareToFeed !== undefined) {
      body.shareToFeed = data.shareToFeed;
    }
    if (data.firstComment) {
      body.firstComment = data.firstComment;
    }
    if (data.targetSocialAccountIds && data.targetSocialAccountIds.length > 0) {
      body.targetSocialAccountIds = data.targetSocialAccountIds;
    }
    if (data.targetSocialAccountId !== undefined) {
      body.targetSocialAccountId = data.targetSocialAccountId;
    }
    if (data.imageFile) {
      const uploadInfo = await assetsApi.getUploadUrl({
        brandId: data.brandId,
        fileName: data.imageFile.name,
        contentType: data.imageFile.type || 'application/octet-stream',
        fileType: data.imageFile.type.startsWith('video/') ? 'video' : 'image',
        fileSize: data.imageFile.size,
      });
      await assetsApi.uploadToS3(data.imageFile, uploadInfo.uploadUrl);
      const asset = await assetsApi.createAsset({
        brandId: data.brandId,
        fileName: data.imageFile.name,
        s3Key: uploadInfo.s3Key,
        fileSize: data.imageFile.size,
        mimeType: data.imageFile.type || 'application/octet-stream',
        fileType: data.imageFile.type.startsWith('video/') ? 'video' : 'image',
      });
      body.assetIds = [asset.asset.id];
    }
    return this.request('/api/content', { method: 'POST', body: JSON.stringify(body) });
  }

  getContentGroup(contentGroupId: string) {
    return this.request(`/api/content/groups/${encodeURIComponent(contentGroupId)}`);
  }

  scheduleContentGroup(contentGroupId: string, scheduledAt: string | null) {
    return this.request(`/api/content/groups/${encodeURIComponent(contentGroupId)}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduledAt }),
    });
  }

  queueContentGroup(contentGroupId: string) {
    return this.request(`/api/content/groups/${encodeURIComponent(contentGroupId)}/queue`, {
      method: 'POST',
    });
  }

  updateContentGroupTemplate(
    contentGroupId: string,
    template: {
      caption?: string;
      contentType?: InstagramContentType;
      shareToFeed?: boolean | null;
      firstComment?: string | null;
      thumbOffset?: number | null;
      assetIds?: string[];
    }
  ) {
    return this.request(`/api/content/groups/${encodeURIComponent(contentGroupId)}/template`, {
      method: 'PATCH',
      body: JSON.stringify(template),
    });
  }

  applyContentGroupTemplate(contentGroupId: string) {
    return this.request(
      `/api/content/groups/${encodeURIComponent(contentGroupId)}/apply-template`,
      {
        method: 'POST',
      }
    );
  }

  resetGroupDestinationToTemplate(contentGroupId: string, contentId: string) {
    return this.request(
      `/api/content/groups/${encodeURIComponent(contentGroupId)}/destinations/${encodeURIComponent(contentId)}/reset-to-template`,
      {
        method: 'POST',
      }
    );
  }

  addContentGroupDestinations(contentGroupId: string, targetSocialAccountIds: string[]) {
    return this.request(`/api/content/groups/${encodeURIComponent(contentGroupId)}/destinations`, {
      method: 'POST',
      body: JSON.stringify({ targetSocialAccountIds }),
    });
  }

  addContentDestinations(contentId: string, targetSocialAccountIds: string[]) {
    return this.request(`/api/content/${encodeURIComponent(contentId)}/destinations`, {
      method: 'POST',
      body: JSON.stringify({ targetSocialAccountIds }),
    });
  }

  deleteContentGroup(contentGroupId: string) {
    return this.request(`/api/content/groups/${encodeURIComponent(contentGroupId)}`, {
      method: 'DELETE',
    });
  }

  // List drafts for a brand (sorted by last modified by default)
  getDrafts(brandId: string) {
    return this.request(`/api/content/pending/${encodeURIComponent(brandId)}`);
  }

  getContentHistory(brandId: string) {
    return this.request(`/api/brands/${brandId}/content/history`);
  }

  publishToInstagram(contentId: string) {
    return this.publishToPlatform(contentId, 'instagram');
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

  async uploadContentImage(contentId: string, brandId: string, fileOrUrl: File | string) {
    if (typeof fileOrUrl === 'string') {
      return this.request('/api/content/upload-image', {
        method: 'POST',
        body: JSON.stringify({ contentId, externalUrl: fileOrUrl }),
      });
    }

    const uploadInfo = await assetsApi.getUploadUrl({
      brandId,
      fileName: fileOrUrl.name,
      contentType: fileOrUrl.type || 'application/octet-stream',
      fileType: fileOrUrl.type.startsWith('video/') ? 'video' : 'image',
      fileSize: fileOrUrl.size,
    });

    await assetsApi.uploadToS3(fileOrUrl, uploadInfo.uploadUrl);
    const asset = await assetsApi.createAsset({
      brandId,
      fileName: fileOrUrl.name,
      s3Key: uploadInfo.s3Key,
      fileSize: fileOrUrl.size,
      mimeType: fileOrUrl.type || 'application/octet-stream',
      fileType: fileOrUrl.type.startsWith('video/') ? 'video' : 'image',
    });

    return this.request('/api/content/upload-image', {
      method: 'POST',
      body: JSON.stringify({ contentId, assetId: asset.asset.id }),
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
    return this.publishNow(postId);
  }

  getCalendarContent(brandId: string, yyyymm: string) {
    return this.request(`/api/brands/${brandId}/calendar/${yyyymm}`);
  }

  getPostDetail(postId: string) {
    return this.request(`/api/posts/${postId}`);
  }

  getSeries(contentSeriesId: string) {
    return this.request(`/api/content/series/${encodeURIComponent(contentSeriesId)}`);
  }

  updateSeries(
    contentSeriesId: string,
    body: {
      name?: string;
      description?: string | null;
      color?: string | null;
      status?: string;
      rolling?: {
        enabled?: boolean;
        minQueueDays?: number;
        targetQueueDays?: number;
        maxQueueDays?: number;
        batchSize?: number;
      };
    }
  ) {
    return this.request(`/api/content/series/${encodeURIComponent(contentSeriesId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  getSeriesRollingStatus(contentSeriesId: string) {
    return this.request(
      `/api/content/series/${encodeURIComponent(contentSeriesId)}/rolling/status`
    );
  }

  refreshSeriesRolling(contentSeriesId: string) {
    return this.request(
      `/api/content/series/${encodeURIComponent(contentSeriesId)}/rolling/refresh`,
      {
        method: 'POST',
      }
    );
  }

  getPostInsights(postId: string) {
    return this.request(`/api/posts/${postId}/insights`);
  }

  getPostComments(
    postId: string,
    page = 1,
    limit = 20,
    opts?: { publicationId?: string; refresh?: boolean }
  ) {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (opts?.publicationId) {
      params.set('publicationId', opts.publicationId);
    }
    if (opts?.refresh) {
      params.set('refresh', 'true');
    }
    return this.request(`/api/posts/${postId}/comments?${params.toString()}`);
  }

  replyToComment(
    postId: string,
    commentId: string,
    message: string,
    opts?: { publicationId?: string }
  ) {
    const params = new URLSearchParams();
    if (opts?.publicationId) {
      params.set('publicationId', opts.publicationId);
    }
    const qs = params.toString();
    return this.request(`/api/posts/${postId}/comments/${commentId}/reply${qs ? `?${qs}` : ''}`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  // hide/delete removed

  likeComment(postId: string, commentId: string, opts?: { publicationId?: string }) {
    const params = new URLSearchParams();
    if (opts?.publicationId) {
      params.set('publicationId', opts.publicationId);
    }
    const qs = params.toString();
    return this.request(`/api/posts/${postId}/comments/${commentId}/like${qs ? `?${qs}` : ''}`, {
      method: 'POST',
    });
  }

  setCommentWorkflow(
    postId: string,
    commentId: string,
    data: { status?: 'open' | 'resolved' | 'archived' },
    opts?: { publicationId?: string }
  ) {
    const params = new URLSearchParams();
    if (opts?.publicationId) {
      params.set('publicationId', opts.publicationId);
    }
    const qs = params.toString();
    return this.request(
      `/api/posts/${postId}/comments/${commentId}/workflow${qs ? `?${qs}` : ''}`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  }

  markAllCommentsRead(postId: string, commentIds?: string[], opts?: { publicationId?: string }) {
    const params = new URLSearchParams();
    if (opts?.publicationId) {
      params.set('publicationId', opts.publicationId);
    }
    const qs = params.toString();
    return this.request(`/api/posts/${postId}/comments/mark-all-read${qs ? `?${qs}` : ''}`, {
      method: 'POST',
      body: JSON.stringify({ commentIds }),
    });
  }

  publishPost(postId: string) {
    return this.publishNow(postId);
  }

  attachAsset(contentId: string, assetId: string) {
    return this.request(`/api/content/${contentId}/asset`, {
      method: 'POST',
      body: JSON.stringify({
        assetId,
      }),
    });
  }

  updateMedia(contentId: string, assetIds: string[]) {
    return this.request(`/api/content/${contentId}/media`, {
      method: 'PUT',
      body: JSON.stringify({ assetIds }),
    });
  }
}
