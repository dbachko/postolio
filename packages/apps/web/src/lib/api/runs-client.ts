import type { HttpRequest } from '../http/http';

export type RunTrigger = 'manual' | 'schedule' | 'api' | 'chat';
export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'canceled';

export type RunRecipeRef = {
  id: string;
  name: string;
  slug: string;
  isCurated: boolean;
};

export type RunSummary = {
  id: string;
  status: RunStatus;
  trigger: RunTrigger;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  recipe: RunRecipeRef;
};

export type RunStep = {
  id: string;
  runId: string;
  index: number;
  type: string;
  name: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  inputJsonRedacted: unknown;
  outputJsonRedacted: unknown;
  errorMessage: string | null;
  createdAt: string;
};

export type RunArtifact = {
  id: string;
  runId: string;
  kind: 'markdown' | 'text' | 'json' | 'asset';
  name: string;
  mimeType: string | null;
  contentText: string | null;
  assetId: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

export type RunCost = {
  id: string;
  runId: string;
  provider: string;
  mode: 'managed' | 'byok';
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: string | null;
  notes: string | null;
  createdAt: string;
};

export type RunCostSummary = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: string | null;
  managedCreditsSpent: number;
};

export type RunCreditsSummary = {
  balanceCredits: number;
  totalGrantedCredits: number;
  totalDebitedCredits: number;
  enforcementEnabled: boolean;
};

export type RunEstimate = {
  estimate: {
    cadenceCount: number;
    stepCounts: {
      llmCalls: number;
      webFetchCalls: number;
      imageCalls: number;
      videoCalls: number;
      audioCalls: number;
    };
    billableCounts: {
      llmCalls: number;
      webFetchCalls: number;
      imageCalls: number;
      videoCalls: number;
      audioCalls: number;
    };
    estimatedCredits: number;
    estimatedUsd: string;
  };
  managedSkillIds: string[];
  balanceCredits: number;
  shortfallCredits: number;
  enforcementEnabled: boolean;
};

export type RunDetailResponse = {
  run: {
    id: string;
    brandId: string;
    status: RunStatus;
    trigger: RunTrigger;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    input: unknown;
    errorCode: string | null;
    errorMessage: string | null;
  };
  recipe: RunRecipeRef;
  recipeVersion: { id: string; version: number };
  steps: RunStep[];
  artifacts: RunArtifact[];
  costs: RunCost[];
  costSummary: RunCostSummary;
};

export class RunsClient {
  constructor(private request: HttpRequest) {}

  listRuns(params: { brandId: string; status?: RunStatus; limit?: number }) {
    const qp = new URLSearchParams({ brandId: params.brandId });
    if (params.status) {
      qp.set('status', params.status);
    }
    if (params.limit != null) {
      qp.set('limit', String(params.limit));
    }
    return this.request(`/api/runs?${qp.toString()}`) as Promise<{ runs: RunSummary[] }>;
  }

  createRun(body: {
    brandId: string;
    recipeVersionId: string;
    trigger?: RunTrigger;
    input?: unknown;
  }) {
    return this.request('/api/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as Promise<{
      runId: string;
      status: RunStatus;
      costEstimate?: {
        estimatedCredits: number;
        estimatedUsd: string;
        shortfallCredits: number;
        balanceCredits: number;
        enforcementEnabled: boolean;
      };
    }>;
  }

  estimateRun(body: { brandId: string; recipeVersionId: string; input?: unknown }) {
    return this.request('/api/runs/estimate', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as Promise<RunEstimate>;
  }

  getCredits(brandId: string) {
    const qp = new URLSearchParams({ brandId });
    return this.request(`/api/runs/credits?${qp.toString()}`) as Promise<{
      credits: RunCreditsSummary;
    }>;
  }

  topUpCredits(body: { brandId: string; credits: number }) {
    return this.request('/api/runs/credits/top-up', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as Promise<{ topUp: { balanceCredits: number; grantedCredits: number } }>;
  }

  getRun(runId: string) {
    return this.request(`/api/runs/${encodeURIComponent(runId)}`) as Promise<RunDetailResponse>;
  }

  cancelRun(runId: string) {
    return this.request(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
    }) as Promise<{
      id: string;
      status: RunStatus;
    }>;
  }
}
