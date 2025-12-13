import type { HttpRequest } from '../http/http';

export class BrandClient {
  constructor(private request: HttpRequest) {}

  // Timezone
  getBrandTimezone(brandId: string) {
    return this.request(`/api/brands/${brandId}/timezone`);
  }

  // Inbox: Comments overview
  getCommentsInbox(brandId: string) {
    return this.request(`/api/brands/${encodeURIComponent(brandId)}/inbox/comments`) as Promise<{
      items: Array<{
        postId: string;
        caption: string | null;
        primaryAssetId: string | null;
        permalink: string | null;
        postedAt: string | null;
        totalComments: number;
        resolvedCount: number;
        newCount: number;
      }>;
    }>;
  }

  updateBrandTimezone(brandId: string, timezone: string | null) {
    return this.request(`/api/brands/${brandId}/timezone`, {
      method: 'PATCH',
      body: JSON.stringify({ timezone }),
    });
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
    options: { maxPosts?: number; maxDays?: number }
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
    // TODO: Backend endpoint not yet implemented
    throw new Error('getConnectedAccounts not yet implemented');
  }

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

  // Saved replies
  getSavedReplies(brandId: string) {
    return this.request(`/api/brands/${encodeURIComponent(brandId)}/replies`);
  }

  createSavedReply(brandId: string, data: { title: string; body: string; isDefault?: boolean }) {
    return this.request(`/api/brands/${encodeURIComponent(brandId)}/replies`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateSavedReply(
    brandId: string,
    replyId: string,
    data: { title?: string; body?: string; isDefault?: boolean }
  ) {
    return this.request(`/api/brands/${encodeURIComponent(brandId)}/replies/${replyId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteSavedReply(brandId: string, replyId: string) {
    return this.request(`/api/brands/${encodeURIComponent(brandId)}/replies/${replyId}`, {
      method: 'DELETE',
    });
  }

  // Instagram DMs
  getDmThreads(brandId: string, opts?: { limit?: number; after?: string }) {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.after) params.set('after', opts.after);
    const qs = params.toString();
    return this.request(
      `/api/brands/${encodeURIComponent(brandId)}/instagram/dms/threads${qs ? `?${qs}` : ''}`
    );
  }

  getDmMessages(brandId: string, threadId: string, opts?: { limit?: number; before?: string }) {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.before) params.set('before', opts.before);
    const qs = params.toString();
    return this.request(
      `/api/brands/${encodeURIComponent(brandId)}/instagram/dms/threads/${encodeURIComponent(threadId)}/messages${qs ? `?${qs}` : ''}`
    );
  }

  sendDmMessage(brandId: string, threadId: string, text: string) {
    return this.request(
      `/api/brands/${encodeURIComponent(brandId)}/instagram/dms/threads/${encodeURIComponent(threadId)}/messages`,
      { method: 'POST', body: JSON.stringify({ text }) }
    );
  }
}
