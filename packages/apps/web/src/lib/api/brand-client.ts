import type { HttpRequest } from '../http/http';

import type { ImageProvider } from '@/types/image-providers';
import type { Platform } from '@/lib/platform-config';

type BrandImageProviderPreference = {
  imageProvider: ImageProvider | null;
  defaultProvider: ImageProvider | null;
};

type ImageAnalyticsResponse = {
  overall: {
    totalGenerated: number;
    totalCost: number;
    avgCostPerImage: number;
  };
  byProvider: Record<
    string,
    {
      count: number;
      totalCost: number;
      totalTime: number;
      avgCost: number;
      avgTime: number;
    }
  >;
  recentLogs: Array<{
    id: string;
    provider: string;
    cost: number;
    generationTime: number;
    status: string;
    createdAt: string;
  }>;
};

export class BrandClient {
  constructor(private request: HttpRequest) {}

  // Timezone
  getBrandTimezone(brandId: string) {
    return this.request(`/api/brands/${brandId}/timezone`);
  }

  updateBrandTimezone(brandId: string, timezone: string | null) {
    return this.request(`/api/brands/${brandId}/timezone`, {
      method: 'PATCH',
      body: JSON.stringify({ timezone }),
    });
  }

  // Image Provider
  getBrandImageProvider(brandId: string): Promise<BrandImageProviderPreference> {
    return this.request(
      `/api/image-providers/${brandId}/preference`
    ) as Promise<BrandImageProviderPreference>;
  }

  updateBrandImageProvider(brandId: string, imageProvider: ImageProvider | null) {
    return this.request(`/api/image-providers/${brandId}/preference`, {
      method: 'POST',
      body: JSON.stringify({ imageProvider }),
    });
  }

  getImageAnalytics(
    brandId: string,
    options?: { startDate?: string; endDate?: string }
  ): Promise<ImageAnalyticsResponse> {
    const params = new URLSearchParams();
    if (options?.startDate) params.set('startDate', options.startDate);
    if (options?.endDate) params.set('endDate', options.endDate);
    const qs = params.toString();
    return this.request(
      `/api/image-providers/${brandId}/analytics${qs ? `?${qs}` : ''}`
    ) as Promise<ImageAnalyticsResponse>;
  }

  // Inbox: Unified items (comments + DMs)
  getInboxItems(
    brandId: string,
    options?: {
      socialAccountIds?: string[];
      channels?: Array<'comments' | 'dms'>;
      platforms?: string[];
      view?: 'to_review' | 'all';
      limit?: number;
    }
  ) {
    const params = new URLSearchParams();

    const socialAccountIds = options?.socialAccountIds || [];
    for (const id of socialAccountIds) {
      if (!id) continue;
      params.append('socialAccountId', id);
    }

    const channels = options?.channels || [];
    for (const channel of channels) {
      if (!channel) continue;
      params.append('channel', channel);
    }

    const platforms = options?.platforms || [];
    for (const platform of platforms) {
      if (!platform) continue;
      params.append('platform', platform);
    }

    if (options?.view) params.set('view', options.view);
    if (options?.limit) params.set('limit', String(options.limit));

    const qs = params.toString();
    return this.request(
      `/api/brands/${encodeURIComponent(brandId)}/inbox/items${qs ? `?${qs}` : ''}`
    ) as Promise<{
      items: Array<
        | {
            type: 'comment_thread';
            platform: Platform;
            socialAccountId: string;
            publicationId: string;
            postId: string;
            caption: string | null;
            primaryAssetId: string | null;
            permalink: string | null;
            postedAt: string | null;
            totalComments: number;
            resolvedCount: number;
            newCount: number;
            lastActivityAt: string | null;
            previewText: string | null;
            previewAuthorUsername: string | null;
          }
        | {
            type: 'dm_conversation';
            platform: Platform;
            socialAccountId: string;
            conversationId: string;
            state: 'active' | 'archived' | 'spam';
            participantUsername: string;
            lastMessageAt: string;
            lastMessageText: string | null;
            lastMessageDirection: 'inbound' | 'outbound' | null;
            messageCount: number;
          }
      >;
    }>;
  }

  ingestInboxComments(
    brandId: string,
    options?: {
      socialAccountIds?: string[];
      sync?: boolean;
      maxPosts?: number;
      perPostLimit?: number;
    }
  ) {
    const params = new URLSearchParams();

    const socialAccountIds = options?.socialAccountIds || [];
    for (const id of socialAccountIds) {
      if (!id) continue;
      params.append('socialAccountId', id);
    }

    if (options?.sync) params.set('sync', 'true');
    if (options?.maxPosts) params.set('maxPosts', String(options.maxPosts));
    if (options?.perPostLimit) params.set('perPostLimit', String(options.perPostLimit));

    const qs = params.toString();
    return this.request(
      `/api/brands/${encodeURIComponent(brandId)}/inbox/comments/ingest${qs ? `?${qs}` : ''}`,
      { method: 'POST' }
    ) as Promise<
      | {
          success: true;
          enqueued: true;
          jobId?: string | number | null;
          nextAllowed?: string | null;
        }
      | {
          success: true;
          enqueued: false;
          result: { postsProcessed: number; commentsUpserted: number };
        }
      | { success: false; error: string; nextAllowed?: string }
    >;
  }

  ingestInboxDMs(
    brandId: string,
    options?: {
      socialAccountIds?: string[];
      sync?: boolean;
      maxThreads?: number;
      perThreadLimit?: number;
    }
  ) {
    const params = new URLSearchParams();

    const socialAccountIds = options?.socialAccountIds || [];
    for (const id of socialAccountIds) {
      if (!id) continue;
      params.append('socialAccountId', id);
    }

    if (options?.sync) params.set('sync', 'true');
    if (options?.maxThreads) params.set('maxThreads', String(options.maxThreads));
    if (options?.perThreadLimit) params.set('perThreadLimit', String(options.perThreadLimit));

    const qs = params.toString();
    return this.request(
      `/api/brands/${encodeURIComponent(brandId)}/inbox/dms/ingest${qs ? `?${qs}` : ''}`,
      { method: 'POST' }
    ) as Promise<
      | {
          success: true;
          enqueued: true;
          jobId?: string | number | null;
          nextAllowed?: string | null;
        }
      | {
          success: true;
          enqueued: false;
          result: {
            accountsProcessed: number;
            threadsProcessed: number;
            conversationsUpserted: number;
            messagesInserted: number;
          };
        }
      | { success: false; error: string; nextAllowed?: string }
    >;
  }

  // CRUD
  getBrands() {
    return this.request('/api/brands');
  }

  createBrand(data: { name: string; description?: string; countryCode?: string | null }) {
    return this.request('/api/brands', { method: 'POST', body: JSON.stringify(data) });
  }

  deleteBrand(brandId: string) {
    return this.request(`/api/brands/${brandId}`, { method: 'DELETE' });
  }

  updateBrand(
    brandId: string,
    data: { name?: string; description?: string; countryCode?: string | null }
  ) {
    return this.request(`/api/brands/${brandId}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  // =================================================================
  // Generic Social Platform Methods (Platform-Agnostic)
  // =================================================================

  /**
   * Initialize OAuth flow for any social platform
   * @param brandId - Brand ID
   * @param platform - Platform name (instagram, facebook, linkedin, etc.)
   */
  initializeSocialOAuth(brandId: string, platform: string) {
    // Use platform-specific route (Instagram has special handling in brands.ts)
    if (platform === 'instagram') {
      return this.request(`/api/brands/${brandId}/instagram/authorize`);
    }
    throw new Error(`OAuth not yet implemented for platform: ${platform}`);
  }

  /**
   * Get connection status for any social platform
   * @param brandId - Brand ID
   * @param platform - Platform name
   * @param refresh - Force refresh from platform API
   */
  getSocialConnectionStatus(brandId: string, platform: string, refresh = false) {
    const query = refresh ? '?refresh=true' : '';
    // Backend route: GET /api/social/:platform/status/:brandId
    return this.request(`/api/social/${platform}/status/${brandId}${query}`);
  }

  /**
   * Disconnect a social platform
   * @param brandId - Brand ID
   * @param platform - Platform name
   * @param options - Optional disconnect options (e.g., remove imported posts)
   */
  disconnectSocial(
    brandId: string,
    platform: string,
    options?: {
      removeImportedPosts?: boolean;
    }
  ) {
    // Backend route: POST /api/social/:platform/disconnect/:brandId
    return this.request(`/api/social/${platform}/disconnect/${brandId}`, {
      method: 'POST',
      body: options ? JSON.stringify(options) : undefined,
    });
  }

  /**
   * Refresh OAuth token for a social platform
   * @param brandId - Brand ID
   * @param platform - Platform name
   */
  refreshSocialToken(_brandId: string, platform: string) {
    // TODO: Backend endpoint not yet implemented
    throw new Error(`Token refresh not yet implemented for platform: ${platform}`);
  }

  /**
   * Sync posts from any social platform
   * @param brandId - Brand ID
   * @param platform - Platform name
   * @param options - Sync options
   */
  syncSocialPosts(
    brandId: string,
    platform: string,
    options: { maxPosts?: number; maxDays?: number; socialAccountId?: string }
  ) {
    // Backend route: POST /api/social/:platform/sync/:brandId
    return this.request(`/api/social/${platform}/sync/${brandId}`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  /**
   * Get sync status for a social platform
   * @param brandId - Brand ID
   * @param platform - Platform name
   */
  getSocialSyncStatus(brandId: string, platform: string) {
    // Use Instagram-specific route for Instagram (in brands-instagram.ts)
    if (platform === 'instagram') {
      return this.request(`/api/brands/${brandId}/instagram/sync-status`);
    }
    throw new Error(`Sync status not yet implemented for platform: ${platform}`);
  }

  /**
   * Get all connected social accounts for a brand
   * @param _brandId - Brand ID
   */
  getConnectedAccounts(_brandId: string) {
    return this.request(`/api/brands/${encodeURIComponent(_brandId)}/social-accounts`) as Promise<{
      brandId: string;
      primarySocialAccountId: string | null;
      defaultPostSocialAccountIds: string[];
      socialAccounts: Array<{
        id: string;
        platform: string;
        externalAccountId: string;
        externalPageId?: string | null;
        username?: string | null;
        displayName?: string | null;
        profilePictureUrl?: string | null;
        disconnected: boolean;
        tokenStatus?: 'healthy' | 'expiring' | 'expired' | 'unknown' | 'disconnected';
        tokenExpiresAt?: string | null;
        metadata?: any;
        sortOrder: number;
        createdAt: string;
        updatedAt: string;
      }>;
    }>;
  }

  setDefaultPostSocialAccounts(brandId: string, socialAccountIds: string[]) {
    return this.request(
      `/api/brands/${encodeURIComponent(brandId)}/social-accounts/default-post-social-accounts`,
      {
        method: 'POST',
        body: JSON.stringify({ socialAccountIds }),
      }
    ) as Promise<{ success: boolean; brandId: string; defaultPostSocialAccountIds: string[] }>;
  }

  setSocialAccountOrder(brandId: string, orderedIds: string[]) {
    return this.request(`/api/brands/${encodeURIComponent(brandId)}/social-accounts/order`, {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    }) as Promise<{ success: boolean; brandId: string; orderedIds: string[] }>;
  }

  // ===============================================================
  // Meta Connect (Instagram + Facebook) — Multi-account flow
  // ===============================================================

  startMetaConnect(brandId: string) {
    return this.request(
      `/api/brands/${encodeURIComponent(brandId)}/social-accounts/meta/authorize`
    ) as Promise<{ authUrl: string; connectSessionId: string }>;
  }

  getMetaConnectCandidates(connectSessionId: string) {
    return this.request(
      `/api/auth/meta/candidates?connectSessionId=${encodeURIComponent(connectSessionId)}`
    ) as Promise<{
      connectSessionId: string;
      brandId: string;
      expiresAt: string | null;
      candidates: Array<{
        candidateId: string;
        platform: 'instagram' | 'facebook';
        externalAccountId: string;
        externalPageId?: string | null;
        username?: string | null;
        displayName?: string | null;
        profilePictureUrl?: string | null;
        metadata?: Record<string, unknown>;
      }>;
    }>;
  }

  finalizeMetaConnect(connectSessionId: string, candidateIds: string[]) {
    return this.request('/api/auth/meta/finalize', {
      method: 'POST',
      body: JSON.stringify({ connectSessionId, candidateIds }),
    }) as Promise<{
      success: boolean;
      brandId: string;
      connected: Array<{ socialAccountId: string; platform: 'instagram' | 'facebook' }>;
      socialAccounts: any[];
    }>;
  }

  disconnectSocialAccount(
    brandId: string,
    socialAccountId: string,
    options?: { removeImportedPosts?: boolean }
  ) {
    return this.request(
      `/api/brands/${encodeURIComponent(brandId)}/social-accounts/${encodeURIComponent(socialAccountId)}/disconnect`,
      {
        method: 'POST',
        body: options ? JSON.stringify(options) : undefined,
      }
    );
  }

  // Social account ordering and default selection are managed via `setSocialAccountOrder`.

  // Brand analysis
  hasBrandProfileProjection(brandId: string) {
    // Use centralized request to keep headers/credentials consistent
    return this.request(`/api/brands/${brandId}/analysis/profile`)
      .then(() => true)
      .catch((e: any) => {
        if (e && /not found|404/i.test(String(e.message))) return false;
        return false;
      });
  }

  startBrandAnalysis(brandId: string, options: { force?: boolean; maxPosts?: number } = {}) {
    return this.request(`/api/brands/${brandId}/analysis`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  getBrandAnalysisStatus(brandId: string) {
    return this.request(`/api/brands/${brandId}/analysis/status`);
  }

  getBrandAnalysisProfile(brandId: string) {
    return this.request(`/api/brands/${brandId}/analysis/profile`);
  }

  getBrandVisualStyles(brandId: string): Promise<{
    inferredStyles: Array<{ emoji: string; title: string; description: string }>;
    hasAnalysis: boolean;
  }> {
    return this.request(`/api/brands/${brandId}/analysis/visual-styles`) as Promise<{
      inferredStyles: Array<{ emoji: string; title: string; description: string }>;
      hasAnalysis: boolean;
    }>;
  }

  // Style freeze core flag
  getFreezeCore(brandId: string) {
    return this.request(`/api/brands/${brandId}/style/freeze-core`);
  }

  setFreezeCore(brandId: string, freezeCore: boolean) {
    return this.request(`/api/brands/${brandId}/style/freeze-core`, {
      method: 'PATCH',
      body: JSON.stringify({ freezeCore }),
    });
  }

  getThemeSuggestions(
    brandId: string,
    opts?: { campaignType?: string; goals?: string[]; limit?: number }
  ) {
    const params = new URLSearchParams();
    if (opts?.campaignType) params.set('campaignType', String(opts.campaignType));
    if (opts?.goals && opts.goals.length) params.set('goals', JSON.stringify(opts.goals));
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return this.request(
      `/api/brands/${encodeURIComponent(brandId)}/theme-suggestions${qs ? `?${qs}` : ''}`
    );
  }

  getBrandAnalyticsSummary(brandId: string) {
    return this.request(`/api/brands/${brandId}/analytics/summary`);
  }

  // Instagram: Preferred Posting Time (Best Time)
  getInstagramBestTime(brandId: string, opts?: { force?: boolean }) {
    const params = new URLSearchParams();
    if (opts?.force) params.set('force', 'true');
    const qs = params.toString();
    return this.request(
      `/api/brands/${encodeURIComponent(brandId)}/instagram/best-time${qs ? `?${qs}` : ''}`
    );
  }

  refreshInstagramBestTime(brandId: string) {
    return this.request(`/api/brands/${encodeURIComponent(brandId)}/instagram/best-time/refresh`, {
      method: 'POST',
    });
  }

  getInstagramBestTimeStatus(brandId: string) {
    return this.request(`/api/brands/${encodeURIComponent(brandId)}/instagram/best-time/status`);
  }
}
