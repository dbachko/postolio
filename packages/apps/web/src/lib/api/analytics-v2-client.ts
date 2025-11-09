import type { HttpRequest } from '../http/http';

export class AnalyticsV2Client {
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

  getBrandSummary(brandId: string) {
    return this.request(`/api/analytics/brands/${brandId}/summary`);
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
}
