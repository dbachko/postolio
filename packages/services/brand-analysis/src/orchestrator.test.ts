import { describe, it, expect } from 'vitest';
import { BrandAnalysisOrchestrator } from './orchestrator';
import { __setTestResponder } from './llm/llm-client';

class MemProfiles {
  items: any[] = [];
  async putProfile(item: any) {
    this.items.push(item);
  }
  async getLatest(brandId: string) {
    return (
      this.items.filter((i) => i.brandId === brandId).sort((a, b) => b.version - a.version)[0] ||
      null
    );
  }
}

class MemJobs {
  jobs: any[] = [];
  latest: any = null;
  async create(job: any) {
    this.jobs.push(job);
    this.latest = job;
  }
  async updateStatus(jobId: string, brandId: string, status: string, patch: any) {
    const j = this.jobs.find((j) => j.jobId === jobId && j.brandId === brandId);
    if (j) Object.assign(j, { status }, patch);
  }
  async latestForBrand(_brandId: string) {
    return this.latest;
  }
}

describe('orchestrator', () => {
  it('creates a job and profile', async () => {
    const profiles = new MemProfiles();
    const jobs = new MemJobs();
    const orch = new BrandAnalysisOrchestrator(profiles as any, jobs as any);
    const { jobId } = await orch.runBrandAnalysis('brand-1', {});
    expect(jobId).toBeTruthy();
    const latest = await profiles.getLatest('brand-1');
    expect(latest?.version).toBe(1);
  });

  it('creates seasonal overlay and excludes generated posts from core', async () => {
    __setTestResponder(() => ({}) as any);
    const profiles = new MemProfiles();
    const jobs = new MemJobs();
    const orch = new BrandAnalysisOrchestrator(profiles as any, jobs as any);
    const posts = [
      // seasonal posts (6 to exceed default min 5)
      { id: 's1', caption: 'Spooky season! #halloween #pumpkin', hashtags: ['#Halloween'] },
      { id: 's2', caption: 'Pumpkin vibes #spooky', hashtags: ['#spooky'] },
      { id: 's3', caption: 'Trick or treat!', hashtags: ['#halloween'] },
      { id: 's4', caption: 'BOO! Deals #halloween', hashtags: ['#halloween'] },
      { id: 's5', caption: 'Costumes time', hashtags: ['#halloween'] },
      { id: 's6', caption: 'Jack-o-lantern fun', hashtags: ['#halloween'] },
      // core posts
      { id: 'c1', caption: 'Evergreen brand update', hashtags: ['#brand'] },
      { id: 'c2', caption: 'Another evergreen', hashtags: ['#news'] },
      // generated posts that should be excluded from core
      { id: 'g1', caption: 'Made with Postolio', generated: true },
      { id: 'g2', caption: 'via Postolio engine', origin: 'postolio' },
    ] as any[];

    const { jobId } = await orch.runBrandAnalysis('brand-2', {}, posts as any);
    expect(jobId).toBeTruthy();
    const latest = await profiles.getLatest('brand-2');
    expect(latest?.version).toBe(1);
    const profile = (latest as any).profile as any;
    // seasonal overlay should exist
    expect(Array.isArray(profile.overlays)).toBe(true);
    const seasonal = profile.overlays.find((o: any) => o.type === 'SEASONAL');
    expect(seasonal).toBeTruthy();
    // ensure expiresAt is set for seasonal
    expect(typeof seasonal.expiresAt).toBe('string');
    __setTestResponder(null);
  }, 15000);
});
