import type { HttpRequest } from '../http/http';

import type { ImageProvider } from '@/types/image-providers';
import {
  buildIngestInboxCommentsQuery,
  buildIngestInboxDMsQuery,
  buildInboxItemsQuery,
} from './brand-client-inbox';
import type {
  BrandImageProviderPreference,
  ContentSeriesSummary,
  GetInboxItemsOptions,
  GetInboxItemsResponse,
  ImageAnalyticsResponse,
  IngestInboxCommentsOptions,
  IngestInboxCommentsResponse,
  IngestInboxDMsOptions,
  IngestInboxDMsResponse,
} from './brand-client-types';

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
    if (options?.startDate) {
      params.set('startDate', options.startDate);
    }
    if (options?.endDate) {
      params.set('endDate', options.endDate);
    }
    const qs = params.toString();
    return this.request(
      `/api/image-providers/${brandId}/analytics${qs ? `?${qs}` : ''}`
    ) as Promise<ImageAnalyticsResponse>;
  }

  // Inbox: Unified items (comments + DMs)
  getInboxItems(brandId: string, options?: GetInboxItemsOptions): Promise<GetInboxItemsResponse> {
    const query = buildInboxItemsQuery(options);
    return this.request(
      `/api/brands/${encodeURIComponent(brandId)}/inbox/items${query}`
    ) as Promise<GetInboxItemsResponse>;
  }

  ingestInboxComments(
    brandId: string,
    options?: IngestInboxCommentsOptions
  ): Promise<IngestInboxCommentsResponse> {
    const query = buildIngestInboxCommentsQuery(options);
    return this.request(
      `/api/brands/${encodeURIComponent(brandId)}/inbox/comments/ingest${query}`,
      {
        method: 'POST',
      }
    ) as Promise<IngestInboxCommentsResponse>;
  }

  ingestInboxDMs(
    brandId: string,
    options?: IngestInboxDMsOptions
  ): Promise<IngestInboxDMsResponse> {
    const query = buildIngestInboxDMsQuery(options);
    return this.request(`/api/brands/${encodeURIComponent(brandId)}/inbox/dms/ingest${query}`, {
      method: 'POST',
    }) as Promise<IngestInboxDMsResponse>;
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
        if (e && /not found|404/i.test(String(e.message))) {
          return false;
        }
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
    if (opts?.campaignType) {
      params.set('campaignType', String(opts.campaignType));
    }
    if (opts?.goals?.length) {
      params.set('goals', JSON.stringify(opts.goals));
    }
    if (opts?.limit) {
      params.set('limit', String(opts.limit));
    }
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
    if (opts?.force) {
      params.set('force', 'true');
    }
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

  getContentSeries(
    brandId: string
  ): Promise<{ success: true; data: { series: ContentSeriesSummary[] } }> {
    return this.request(`/api/brands/${encodeURIComponent(brandId)}/content-series`) as Promise<{
      success: true;
      data: { series: ContentSeriesSummary[] };
    }>;
  }
}
