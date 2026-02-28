export type GetRunResult = {
  run: {
    id: string;
    brandId: string;
    status: 'queued' | 'running' | 'success' | 'failed' | 'canceled';
    trigger: 'manual' | 'schedule' | 'api' | 'chat';
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    input: unknown;
    errorCode: string | null;
    errorMessage: string | null;
  };
  recipe: { id: string; name: string; slug: string; isCurated: boolean };
  recipeVersion: { id: string; version: number };
  steps: Array<{
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
  }>;
  artifacts: Array<{
    id: string;
    runId: string;
    kind: 'markdown' | 'text' | 'json' | 'asset';
    name: string;
    mimeType: string | null;
    contentText: string | null;
    assetId: string | null;
    sizeBytes: number | null;
    createdAt: string;
  }>;
  costs: Array<{
    id: string;
    runId: string;
    provider: string;
    mode: 'managed' | 'byok';
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: string | null;
    notes: string | null;
    createdAt: string;
  }>;
  costSummary: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalEstimatedCostUsd: string | null;
    managedCreditsSpent: number;
  };
};
