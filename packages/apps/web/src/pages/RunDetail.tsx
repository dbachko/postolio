import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { runs as runsApi } from '@/lib/api';
import type { RunArtifact, RunStatus } from '@/lib/api/runs-client';

import { CostTab, InputsTab, OutputTab, TraceTab } from './run-detail/components/run-detail-tabs';

function statusBadgeVariant(
  status: RunStatus
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'success') {
    return 'secondary';
  }
  if (status === 'failed') {
    return 'destructive';
  }
  if (status === 'running' || status === 'queued') {
    return 'outline';
  }
  return 'outline';
}

function parseCreatedContent(artifacts: RunArtifact[]): null | {
  contentSeriesId: string | null;
  contentIds: string[];
} {
  const artifact = artifacts.find(
    (value) => value.kind === 'json' && value.name === 'created_content.json'
  );
  if (!artifact?.contentText) {
    return null;
  }
  try {
    const parsed = JSON.parse(artifact.contentText) as any;
    const contentSeriesId =
      typeof parsed?.contentSeriesId === 'string' ? parsed.contentSeriesId : null;
    const contentIds = Array.isArray(parsed?.contentIds)
      ? parsed.contentIds.filter((id: any) => typeof id === 'string')
      : [];
    if (!contentSeriesId && contentIds.length === 0) {
      return null;
    }
    return { contentSeriesId, contentIds };
  } catch {
    return null;
  }
}

function RunDetailHeader({
  data,
  status,
  canCancel,
  cancelPending,
  onBack,
  onCancel,
}: {
  data: any;
  status: RunStatus | undefined;
  canCancel: boolean;
  cancelPending: boolean;
  onBack: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-foreground text-2xl font-semibold">
            {data.recipe?.name || 'Generation'}
          </h1>
          <Badge variant={status ? statusBadgeVariant(status) : 'outline'}>{status}</Badge>
        </div>
        <div className="text-muted-foreground text-sm">
          Generation ID: <span className="font-mono">{data.run.id}</span>
        </div>
        {data.run.errorMessage ? (
          <div className="text-destructive text-sm">{data.run.errorMessage}</div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        {canCancel ? (
          <Button variant="destructive" onClick={onCancel} disabled={cancelPending}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RunDetailContent({
  data,
  status,
  canCancel,
  cancelPending,
  createdContent,
  artifactsByKind,
  onBack,
  onCancel,
}: {
  data: any;
  status: RunStatus | undefined;
  canCancel: boolean;
  cancelPending: boolean;
  createdContent: { contentSeriesId: string | null; contentIds: string[] } | null;
  artifactsByKind: Record<string, RunArtifact[]>;
  onBack: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-6">
      <RunDetailHeader
        data={data}
        status={status}
        canCancel={canCancel}
        cancelPending={cancelPending}
        onBack={onBack}
        onCancel={onCancel}
      />

      <Tabs defaultValue="output">
        <TabsList>
          <TabsTrigger value="output">Output</TabsTrigger>
          <TabsTrigger value="trace">Trace</TabsTrigger>
          <TabsTrigger value="inputs">Inputs</TabsTrigger>
          <TabsTrigger value="cost">Cost</TabsTrigger>
        </TabsList>

        <OutputTab data={data} createdContent={createdContent} artifactsByKind={artifactsByKind} />
        <TraceTab data={data} />
        <InputsTab data={data} />
        <CostTab data={data} />
      </Tabs>
    </div>
  );
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
      return status === 'queued' || status === 'running' ? 1500 : false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => await runsApi.cancelRun(runId!),
    onSuccess: async () => {
      toast.success('Generation canceled');
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      await queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to cancel generation');
    },
  });

  const data = runQuery.data;
  const status = data?.run?.status as RunStatus | undefined;
  const canCancel = status === 'queued' || status === 'running';

  const artifactsByKind = useMemo(() => {
    const artifacts = data?.artifacts ?? [];
    const groups: Record<string, RunArtifact[]> = {};
    for (const artifact of artifacts) {
      groups[artifact.kind] = groups[artifact.kind] || [];
      groups[artifact.kind].push(artifact);
    }
    return groups;
  }, [data?.artifacts]);

  const createdContent = useMemo(
    () => parseCreatedContent(data?.artifacts ?? []),
    [data?.artifacts]
  );
  const didInvalidateCalendarRef = useRef(false);

  useEffect(() => {
    if (didInvalidateCalendarRef.current || data?.run.status !== 'success' || !createdContent) {
      return;
    }
    didInvalidateCalendarRef.current = true;
    queryClient.invalidateQueries({ queryKey: ['calendar', data.run.brandId] }).catch(() => {});
    queryClient
      .invalidateQueries({ queryKey: ['content-series', data.run.brandId] })
      .catch(() => {});
  }, [createdContent, data, queryClient]);

  if (!runId) {
    return <div className="text-muted-foreground text-sm">Missing generation id.</div>;
  }
  if (!data && runQuery.isLoading) {
    return <div className="text-muted-foreground text-sm">Loading…</div>;
  }
  if (!data) {
    return (
      <div className="space-y-3">
        <div className="text-muted-foreground text-sm">Generation not found.</div>
        <Button variant="outline" onClick={() => navigate('/runs')}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <RunDetailContent
      data={data}
      status={status}
      canCancel={canCancel}
      cancelPending={cancelMutation.isPending}
      createdContent={createdContent}
      artifactsByKind={artifactsByKind}
      onBack={() => navigate('/runs')}
      onCancel={() => cancelMutation.mutate()}
    />
  );
}
