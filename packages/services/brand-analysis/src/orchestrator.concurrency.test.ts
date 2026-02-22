import { describe, it, expect } from 'vitest';
import { BrandAnalysisOrchestrator } from './orchestrator';

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
    if (j) {
      Object.assign(j, { status }, patch);
    }
  }
  async latestForBrand(_brandId: string) {
    return this.latest;
  }
}

describe('orchestrator concurrency guard', () => {
  it('reuses running job when force is false', async () => {
    const profiles = new MemProfiles();
    const jobs = new MemJobs();
    jobs.latest = {
      jobId: 'existing',
      brandId: 'b',
      status: 'running',
      requestedAt: new Date().toISOString(),
    };
    const orch = new BrandAnalysisOrchestrator(profiles as any, jobs as any);
    const { jobId } = await orch.runBrandAnalysis('b', { force: false });
    expect(jobId).toBe('existing');
  });
});
