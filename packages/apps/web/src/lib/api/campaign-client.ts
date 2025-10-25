import type { HttpRequest } from '../http/http';

export class CampaignClient {
  constructor(private request: HttpRequest) {}

  private sanitizeGoals(payload: any) {
    if (!payload || typeof payload !== 'object') return payload;
    if ('goals' in payload) {
      const g = (payload as any).goals;
      if (Array.isArray(g)) {
        (payload as any).goals = g
          .map((s: unknown) => (typeof s === 'string' ? s.trim() : s))
          .filter((s: unknown) => typeof s === 'string' && s.length > 0);
        if ((payload as any).goals.length === 0) delete (payload as any).goals;
      } else if (typeof g === 'string') {
        const t = g.trim();
        (payload as any).goals = t.length ? t : undefined;
      }
    }
    return payload;
  }

  createCampaign(config: any) {
    const body = this.sanitizeGoals({ ...(config || {}) });
    return this.request(`/api/campaigns`, { method: 'POST', body: JSON.stringify(body) });
  }

  startCampaign(campaignId: string) {
    return this.request(`/api/campaigns/${campaignId}/start`, { method: 'POST' });
  }

  analyzeCampaignGoal(data: {
    brandId: string;
    goal: string;
    themes?: string[];
    campaignType?: string;
  }) {
    return this.request('/api/campaigns/analyze-goal', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  generateCampaignStrategy(data: any) {
    const body = this.sanitizeGoals({ ...(data || {}) });
    return this.request('/api/campaigns/strategy', { method: 'POST', body: JSON.stringify(body) });
  }

  listCampaigns(brandId?: string) {
    const url = brandId ? `/api/campaigns?brandId=${brandId}` : '/api/campaigns';
    return this.request(url);
  }

  getCampaign(campaignId: string) {
    return this.request(`/api/campaigns/${campaignId}`);
  }

  fillCampaignWindow(campaignId: string) {
    return this.request(`/api/campaigns/${campaignId}/fill-window`, { method: 'POST' });
  }

  deleteCampaign(campaignId: string) {
    return this.request(`/api/campaigns/${campaignId}`, { method: 'DELETE' });
  }

  getScheduleAheadLimit() {
    return this.request('/api/account/limits/schedule-ahead');
  }

  updateCampaign(campaignId: string, patch: any) {
    const body = this.sanitizeGoals({ ...(patch || {}) });
    return this.request(`/api/campaigns/${campaignId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  // Analytics
  getCampaignMetrics(campaignId: string) {
    return this.request(`/api/campaigns/${campaignId}/analytics`);
  }

  getCampaignRecommendations(campaignId: string) {
    return this.request(`/api/campaigns/${campaignId}/analytics/recommendations`);
  }

  getCampaignROI(campaignId: string) {
    return this.request(`/api/campaigns/${campaignId}/analytics/roi`);
  }

  // Regeneration
  regenerateContent(
    campaignId: string,
    params: { themes?: string[]; style?: string; contentIds?: string[] }
  ) {
    return this.request(`/api/campaigns/${campaignId}/regenerate`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  getRegenerationJobProgress(jobId: string) {
    return this.request(`/api/campaigns/regeneration-jobs/${jobId}`);
  }

  cancelRegenerationJob(jobId: string) {
    return this.request(`/api/campaigns/regeneration-jobs/${jobId}`, { method: 'DELETE' });
  }
}
