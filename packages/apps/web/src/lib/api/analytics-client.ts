import type { HttpRequest } from '../http/http';

export class AnalyticsClient {
  constructor(private request: HttpRequest) {}

  getPublicationsByContent(contentId: string) {
    const qs = new URLSearchParams({ contentId }).toString();
    return this.request(`/api/publications?${qs}`);
  }

  getPublicationLatest(publicationId: string) {
    return this.request(`/api/analytics/publications/${publicationId}`);
  }

  refreshPublication(publicationId: string) {
    return this.request(`/api/analytics/publications/${publicationId}/refresh`, {
      method: 'POST',
    });
  }

  getCampaignAggregates(campaignId: string) {
    return this.request(`/api/analytics/campaigns/${campaignId}`);
  }

  getCampaignMetrics(campaignId: string) {
    return this.request(`/api/analytics/campaigns/${campaignId}/metrics`);
  }

  getCampaignRecommendations(campaignId: string) {
    return this.request(`/api/analytics/campaigns/${campaignId}/recommendations`);
  }

  getCampaignROI(campaignId: string) {
    return this.request(`/api/analytics/campaigns/${campaignId}/roi`);
  }

  getBrandSummary(brandId: string, period: '7d' | '30d' | '90d' = '30d') {
    const qs = new URLSearchParams({ period }).toString();
    return this.request(`/api/analytics/brands/${brandId}/summary?${qs}`);
  }

  getBrandTopPublications(brandId: string, limit = 10) {
    const qs = new URLSearchParams({ limit: String(limit) }).toString();
    return this.request(`/api/analytics/brands/${brandId}/top-publications?${qs}`);
  }

  refreshBrandAccounts(brandId: string) {
    return this.request(`/api/analytics/brands/${brandId}/account/refresh`, {
      method: 'POST',
    });
  }

  getBrandAccountSeries(brandId: string, window: '7d' | '30d' | '90d' = '30d') {
    const qs = new URLSearchParams({ window }).toString();
    return this.request(`/api/analytics/brands/${brandId}/account/series?${qs}`);
  }

  getBrandHashtags(brandId: string) {
    return this.request(`/api/analytics/brands/${brandId}/hashtags`);
  }

  getBrandAudience(brandId: string) {
    return this.request(`/api/analytics/brands/${brandId}/audience`);
  }

  getBrandPosts(
    brandId: string,
    options?: {
      platform?: string;
      sortBy?: string;
      order?: 'asc' | 'desc';
      limit?: number;
      offset?: number;
    }
  ) {
    const params = new URLSearchParams();
    if (options?.platform) params.set('platform', options.platform);
    if (options?.sortBy) params.set('sortBy', options.sortBy);
    if (options?.order) params.set('order', options.order);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));

    const qs = params.toString();
    return this.request(`/api/analytics/brands/${brandId}/posts${qs ? `?${qs}` : ''}`);
  }
}
