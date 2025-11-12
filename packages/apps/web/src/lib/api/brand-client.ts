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
        imageUrl: string | null;
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

  // Instagram OAuth / status
  initializeInstagramOAuth(brandId: string) {
    return this.request(`/api/brands/${brandId}/instagram/authorize`);
  }

  getInstagramConnectionStatus(brandId: string, refresh = false) {
    const query = refresh ? '?refresh=true' : '';
    return this.request(`/api/brands/${brandId}/instagram/status${query}`);
  }

  disconnectInstagram(brandId: string) {
    return this.request(`/api/brands/${brandId}/instagram/disconnect`, { method: 'POST' });
  }

  refreshInstagramToken(brandId: string) {
    return this.request(`/api/brands/${brandId}/instagram/refresh-token`, { method: 'POST' });
  }

  // Instagram sync
  syncInstagramPosts(brandId: string, options: { maxPosts?: number; maxDays?: number }) {
    return this.request(`/api/brands/${brandId}/instagram/sync`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  getInstagramSyncStatus(brandId: string) {
    return this.request(`/api/brands/${brandId}/instagram/sync-status`);
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
