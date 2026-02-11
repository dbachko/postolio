import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { runs as runsApi } from '@/lib/api';
import type { RunStatus, RunArtifact, RunStep } from '@/lib/api/runs-client';

function statusBadgeVariant(
  status: RunStatus
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'success') return 'secondary';
  if (status === 'failed') return 'destructive';
  if (status === 'running' || status === 'queued') return 'outline';
  return 'outline';
}

function jsonPretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function artifactTitle(a: RunArtifact): string {
  if (a.kind === 'asset') return a.assetId ? `${a.name} (${a.assetId})` : a.name;
  return a.name;
}

function stepDuration(step: RunStep): string | null {
  if (!step.startedAt || !step.finishedAt) return null;
  const ms = new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function RunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const runQuery = useQuery({
    queryKey: ['run', runId],
    enabled: Boolean(runId),
    queryFn: async () => await runsApi.getRun(runId!),
    refetchInterval: (query) => {
      const status = (query.state.data as any)?.run?.status as RunStatus | undefined;
      if (status === 'queued' || status === 'running') return 1500;
      return false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => await runsApi.cancelRun(runId!),
    onSuccess: async () => {
      toast.success('Run canceled');
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      await queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel run');
    },
  });

  const data = runQuery.data;
  const status = data?.run?.status as RunStatus | undefined;

  const canCancel = status === 'queued' || status === 'running';

  const artifactsByKind = useMemo(() => {
    const artifacts = data?.artifacts ?? [];
    const groups: Record<string, RunArtifact[]> = {};
    for (const a of artifacts) {
      groups[a.kind] = groups[a.kind] || [];
      groups[a.kind].push(a);
    }
    return groups;
  }, [data?.artifacts]);

  if (!runId) {
    return <div className="text-muted-foreground text-sm">Missing run id.</div>;
  }

  if (!data && runQuery.isLoading) {
    return <div className="text-muted-foreground text-sm">Loading…</div>;
  }

  if (!data) {
    return (
      <div className="space-y-3">
        <div className="text-muted-foreground text-sm">Run not found.</div>
        <Button variant="outline" onClick={() => navigate('/runs')}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-foreground text-2xl font-semibold">{data.recipe?.name || 'Run'}</h1>
            <Badge variant={status ? statusBadgeVariant(status) : 'outline'}>{status}</Badge>
          </div>
          <div className="text-muted-foreground text-sm">
            Run ID: <span className="font-mono">{data.run.id}</span>
          </div>
          {data.run.errorMessage ? (
            <div className="text-destructive text-sm">{data.run.errorMessage}</div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/runs')}>
            Back
          </Button>
          {canCancel ? (
            <Button
              variant="destructive"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs defaultValue="output">
        <TabsList>
          <TabsTrigger value="output">Output</TabsTrigger>
          <TabsTrigger value="trace">Trace</TabsTrigger>
          <TabsTrigger value="inputs">Inputs</TabsTrigger>
          <TabsTrigger value="cost">Cost</TabsTrigger>
        </TabsList>

        <TabsContent value="output" className="space-y-4">
          {data.artifacts.length === 0 ? (
            <div className="text-muted-foreground text-sm">No artifacts yet.</div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {Object.values(artifactsByKind)
                .flat()
                .map((a) => (
                  <Card key={a.id} className="bg-card border-border">
                    <CardHeader className="space-y-1">
                      <CardTitle className="text-foreground text-sm">{artifactTitle(a)}</CardTitle>
                      <div className="text-muted-foreground text-xs">{a.kind}</div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {a.kind === 'asset' ? (
                        <div className="space-y-2">
                          <div className="text-muted-foreground text-sm">
                            Asset ID: <span className="font-mono">{a.assetId || '—'}</span>
                          </div>
                          {a.assetId ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => navigate(`/assets/${a.assetId}`)}
                            >
                              View asset
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <pre className="bg-muted text-foreground max-h-[420px] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                          {a.contentText || '—'}
                        </pre>
                      )}
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="trace" className="space-y-3">
          {data.steps.length === 0 ? (
            <div className="text-muted-foreground text-sm">No steps yet.</div>
          ) : (
            <div className="space-y-3">
              {data.steps.map((s) => (
                <details key={s.id} className="bg-card border-border rounded-md border p-4">
                  <summary className="text-foreground flex cursor-pointer list-none items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <Badge variant="outline">{s.status}</Badge>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{s.name}</div>
                        <div className="text-muted-foreground truncate text-xs">{s.type}</div>
                      </div>
                    </div>
                    <div className="text-muted-foreground text-xs">{stepDuration(s) || ''}</div>
                  </summary>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs">Input</div>
                      <pre className="bg-muted text-foreground max-h-[320px] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                        {jsonPretty(s.inputJsonRedacted)}
                      </pre>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs">Output</div>
                      <pre className="bg-muted text-foreground max-h-[320px] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                        {jsonPretty(s.outputJsonRedacted)}
                      </pre>
                    </div>
                  </div>
                  {s.errorMessage ? (
                    <div className="text-destructive mt-3 text-sm">{s.errorMessage}</div>
                  ) : null}
                </details>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="inputs" className="space-y-3">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground text-base">Run inputs</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted text-foreground overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                {jsonPretty(data.run.input)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cost" className="space-y-3">
          {data.costs.length === 0 ? (
            <div className="text-muted-foreground text-sm">No cost data yet.</div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {data.costs.map((c) => (
                <Card key={c.id} className="bg-card border-border">
                  <CardHeader className="space-y-1">
                    <CardTitle className="text-foreground text-sm">
                      {c.provider} · {c.mode}
                    </CardTitle>
                    <div className="text-muted-foreground text-xs">{c.notes || '—'}</div>
                  </CardHeader>
                  <CardContent className="text-muted-foreground space-y-1 text-sm">
                    <div>Input tokens: {c.inputTokens}</div>
                    <div>Output tokens: {c.outputTokens}</div>
                    <div>Estimated cost: {c.estimatedCostUsd || '—'}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
