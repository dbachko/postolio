import { describe, it, expect, vi } from 'vitest';

vi.mock('./models/profile-schema', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    validateProfile: () => ({ ok: false, errors: ['forced invalid'] }),
  };
});

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
  async create(job: any) {
    this.jobs.push(job);
  }
  async updateStatus(jobId: string, brandId: string, status: string, patch: any) {
    const j = this.jobs.find((j) => j.jobId === jobId && j.brandId === brandId);
    if (j) {
      Object.assign(j, { status }, patch);
    }
  }
  async latestForBrand(_brandId: string) {
    return null;
  }
}

describe('orchestrator failure path', () => {
  it('marks job failed when validation fails twice', async () => {
    const profiles = new MemProfiles();
    const jobs = new MemJobs();
    const orch = new BrandAnalysisOrchestrator(profiles as any, jobs as any);
    await expect(orch.runBrandAnalysis('brand-2', {})).rejects.toBeTruthy();
    expect(jobs.jobs[0].status).toBe('failed');
    expect(jobs.jobs[0].errorMessage).toContain('validation');
  });
});
