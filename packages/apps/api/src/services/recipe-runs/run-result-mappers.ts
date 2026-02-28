import type { GetRunResult } from './runs-service-types.js';

function mapRunSteps(steps: any[]): GetRunResult['steps'] {
  return steps.map((s) => ({
    id: s.id,
    runId: s.runId,
    index: s.index,
    type: s.type,
    name: s.name,
    status: s.status,
    startedAt: s.startedAt ? s.startedAt.toISOString() : null,
    finishedAt: s.finishedAt ? s.finishedAt.toISOString() : null,
    inputJsonRedacted: s.inputJsonRedacted,
    outputJsonRedacted: s.outputJsonRedacted,
    errorMessage: s.errorMessage,
    createdAt: s.createdAt.toISOString(),
  }));
}

function mapRunArtifacts(artifacts: any[]): GetRunResult['artifacts'] {
  return artifacts.map((a) => ({
    id: a.id,
    runId: a.runId,
    kind: a.kind,
    name: a.name,
    mimeType: a.mimeType,
    contentText: a.contentText,
    assetId: a.assetId,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt.toISOString(),
  }));
}

function mapRunCosts(costs: any[]): GetRunResult['costs'] {
  return costs.map((c) => ({
    id: c.id,
    runId: c.runId,
    provider: c.provider,
    mode: c.mode,
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
    estimatedCostUsd: c.estimatedCostUsd ? c.estimatedCostUsd.toString() : null,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
  }));
}

function buildCostSummary(costs: any[], managedCreditsSpent: number): GetRunResult['costSummary'] {
  const totalInputTokens = costs.reduce((sum, cost) => sum + (cost.inputTokens || 0), 0);
  const totalOutputTokens = costs.reduce((sum, cost) => sum + (cost.outputTokens || 0), 0);
  const totalEstimatedCostUsd = costs.reduce((sum, cost) => {
    if (!cost.estimatedCostUsd) {
      return sum;
    }
    return sum + Number(cost.estimatedCostUsd.toString() || '0');
  }, 0);

  return {
    totalInputTokens,
    totalOutputTokens,
    totalEstimatedCostUsd: totalEstimatedCostUsd > 0 ? totalEstimatedCostUsd.toFixed(4) : null,
    managedCreditsSpent,
  };
}

export function buildGetRunResult(run: any, managedCreditsSpent: number): GetRunResult {
  return {
    run: {
      id: run.id,
      brandId: run.brandId,
      status: run.status,
      trigger: run.trigger,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt ? run.startedAt.toISOString() : null,
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      input: run.inputJson,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
    },
    recipe: run.recipeTemplate,
    recipeVersion: run.recipeTemplateVersion,
    steps: mapRunSteps(run.steps),
    artifacts: mapRunArtifacts(run.artifacts),
    costs: mapRunCosts(run.costs),
    costSummary: buildCostSummary(run.costs, managedCreditsSpent),
  };
}
