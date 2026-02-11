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
};

export class RunsClient {
  constructor(private request: HttpRequest) {}

  listRuns(params: { brandId: string; status?: RunStatus; limit?: number }) {
    const qp = new URLSearchParams({ brandId: params.brandId });
    if (params.status) qp.set('status', params.status);
    if (params.limit != null) qp.set('limit', String(params.limit));
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
    }) as Promise<{ runId: string; status: RunStatus }>;
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
