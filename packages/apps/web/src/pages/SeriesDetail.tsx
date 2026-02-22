import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useBrandStore } from '@/stores/brandStore';
import { useCalendarFilterStore } from '@/stores/calendarFilterStore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { content as contentApi } from '@/lib/api';

type RollingConfig = {
  enabled: boolean;
  minQueueDays: number;
  targetQueueDays: number;
  maxQueueDays: number;
  batchSize: number;
};

type RollingStatus = {
  contentSeriesId: string;
  timezone: string;
  daysAhead: number;
  furthestDayOffset: number;
  futurePostCount: number;
  activeScheduleRuns: number;
  needsGeneration: boolean;
  recommendedPostsToGenerate: number;
  nextGenerationAt: string | null;
  missingDates: string[];
  rolling: RollingConfig;
  generator: {
    source: 'recipe';
    recipeTemplateId: string | null;
    recipeTemplateVersionId: string;
  } | null;
};

type ContentSeries = {
  id: string;
  brandId: string;
  key: string | null;
  name: string;
  description: string | null;
  color: string | null;
  kind: 'batch' | 'rolling';
  status: 'active' | 'paused' | 'archived';
  rollingConfigJson?: unknown;
  createdAt: string;
  updatedAt: string;
};

type GenerationSummary = {
  id: string;
  status: string;
  trigger: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  recipe: {
    id: string;
    slug: string;
    name: string;
    category: string;
    version: number | null;
  } | null;
};

type SeriesContentItem = {
  id: string;
  caption: string;
  status: string;
  scheduledAt: string | null;
  postedAt: string | null;
  recipeRunId: string | null;
  generatedByRecipe: { id: string; slug: string; name: string } | null;
};

function statusBadgeVariant(
  status: ContentSeries['status']
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') {
    return 'secondary';
  }
  if (status === 'paused') {
    return 'outline';
  }
  return 'outline';
}

function toRollingConfig(value: unknown): RollingConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : false;
  const minQueueDays = Number.isFinite(Number(raw.minQueueDays))
    ? Math.max(1, Math.floor(Number(raw.minQueueDays)))
    : 3;
  const targetQueueDays = Number.isFinite(Number(raw.targetQueueDays))
    ? Math.max(minQueueDays, Math.floor(Number(raw.targetQueueDays)))
    : Math.max(minQueueDays, 7);
  const maxQueueDays = Number.isFinite(Number(raw.maxQueueDays))
    ? Math.max(targetQueueDays, Math.floor(Number(raw.maxQueueDays)))
    : Math.max(targetQueueDays, 14);
  const batchSize = Number.isFinite(Number(raw.batchSize))
    ? Math.max(1, Math.min(maxQueueDays, Math.floor(Number(raw.batchSize))))
    : 3;
  return {
    enabled,
    minQueueDays,
    targetQueueDays,
    maxQueueDays,
    batchSize,
  };
}

function parseNumberInput(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(1, n);
}

export function SeriesDetail() {
  const { selectedBrand } = useBrandStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { contentSeriesId } = useParams<{ contentSeriesId: string }>();

  const seriesQuery = useQuery({
    queryKey: ['content-series-detail', contentSeriesId],
    enabled: Boolean(contentSeriesId),
    queryFn: async () => await contentApi.getSeries(contentSeriesId!),
  });

  const rollingStatusQuery = useQuery({
    queryKey: ['content-series-rolling-status', contentSeriesId],
    enabled: Boolean(contentSeriesId),
    queryFn: async () => await contentApi.getSeriesRollingStatus(contentSeriesId!),
    retry: false,
  });

  const data = seriesQuery.data as any;
  const series = (data?.data?.contentSeries ?? null) as ContentSeries | null;
  const generations = (data?.data?.generations ?? []) as GenerationSummary[];
  const contents = (data?.data?.contents ?? []) as SeriesContentItem[];
  const rollingStatus = (rollingStatusQuery.data as any)?.data?.rolling as RollingStatus | null;

  const [rollingDraft, setRollingDraft] = useState<RollingConfig>(() =>
    toRollingConfig(series?.rollingConfigJson)
  );

  useEffect(() => {
    setRollingDraft(toRollingConfig(series?.rollingConfigJson));
  }, [series?.rollingConfigJson]);

  const canEditStatus = Boolean(series) && selectedBrand && series?.brandId === selectedBrand.id;

  const nextPauseResume = useMemo(() => {
    if (!series) {
      return null;
    }
    if (series.status === 'active') {
      return { label: 'Pause', status: 'paused' as const };
    }
    if (series.status === 'paused') {
      return { label: 'Resume', status: 'active' as const };
    }
    return null;
  }, [series]);

  const updateMutation = useMutation({
    mutationFn: async (payload: { status?: ContentSeries['status']; rolling?: RollingConfig }) => {
      if (!contentSeriesId) {
        throw new Error('Missing series id');
      }
      return await contentApi.updateSeries(contentSeriesId, payload);
    },
    onSuccess: async () => {
      toast.success('Series updated');
      await queryClient.invalidateQueries({ queryKey: ['content-series-detail', contentSeriesId] });
      await queryClient.invalidateQueries({
        queryKey: ['content-series-rolling-status', contentSeriesId],
      });
      if (selectedBrand?.id) {
        await queryClient.invalidateQueries({ queryKey: ['content-series', selectedBrand.id] });
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update series');
    },
  });

  const refreshRollingMutation = useMutation({
    mutationFn: async () => {
      if (!contentSeriesId) {
        throw new Error('Missing series id');
      }
      return await contentApi.refreshSeriesRolling(contentSeriesId);
    },
    onSuccess: async (res: any) => {
      const refresh = res?.data?.rollingRefresh;
      if (refresh?.triggered && refresh?.runId) {
        toast.success('Rolling refresh enqueued');
      } else {
        toast.success('Rolling status refreshed');
      }
      await queryClient.invalidateQueries({ queryKey: ['content-series-detail', contentSeriesId] });
      await queryClient.invalidateQueries({
        queryKey: ['content-series-rolling-status', contentSeriesId],
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to refresh rolling queue');
    },
  });

  if (!contentSeriesId) {
    return <div className="text-muted-foreground text-sm">Missing series id.</div>;
  }

  if (seriesQuery.isLoading) {
    return <div className="text-muted-foreground text-sm">Loading…</div>;
  }

  if (!series) {
    return (
      <div className="space-y-3">
        <div className="text-muted-foreground text-sm">Series not found.</div>
        <Button variant="outline" onClick={() => navigate('/series')}>
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
            <h1 className="text-foreground text-2xl font-semibold">{series.name}</h1>
            <Badge variant="outline">{series.kind}</Badge>
            <Badge variant={statusBadgeVariant(series.status)}>{series.status}</Badge>
          </div>
          <div className="text-muted-foreground text-sm">{series.description || '—'}</div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/series')}>
            Back
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              useCalendarFilterStore.getState().setSeries([series.id]);
              navigate('/content');
            }}
          >
            Open calendar
          </Button>
          {canEditStatus && nextPauseResume ? (
            <Button
              variant="outline"
              onClick={() => updateMutation.mutate({ status: nextPauseResume.status })}
              disabled={updateMutation.isPending}
            >
              {nextPauseResume.label}
            </Button>
          ) : null}
          {canEditStatus && series.status !== 'archived' ? (
            <Button
              variant="destructive"
              onClick={() => updateMutation.mutate({ status: 'archived' })}
              disabled={updateMutation.isPending}
            >
              Archive
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="space-y-1">
          <CardTitle className="text-foreground text-base">Rolling generation</CardTitle>
          <CardDescription className="text-muted-foreground">
            Keep this series topped up with future drafts generated from its recipe source.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="rolling-enabled">Enabled</Label>
              <div>
                <Switch
                  id="rolling-enabled"
                  checked={rollingDraft.enabled}
                  onCheckedChange={(checked) =>
                    setRollingDraft((prev) => ({ ...prev, enabled: Boolean(checked) }))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rolling-min">Min queue days</Label>
              <Input
                id="rolling-min"
                type="number"
                min={1}
                value={rollingDraft.minQueueDays}
                onChange={(event) => {
                  const next = parseNumberInput(event.target.value, rollingDraft.minQueueDays);
                  setRollingDraft((prev) => ({ ...prev, minQueueDays: next }));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rolling-target">Target queue days</Label>
              <Input
                id="rolling-target"
                type="number"
                min={1}
                value={rollingDraft.targetQueueDays}
                onChange={(event) => {
                  const next = parseNumberInput(event.target.value, rollingDraft.targetQueueDays);
                  setRollingDraft((prev) => ({ ...prev, targetQueueDays: next }));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rolling-max">Max queue days</Label>
              <Input
                id="rolling-max"
                type="number"
                min={1}
                value={rollingDraft.maxQueueDays}
                onChange={(event) => {
                  const next = parseNumberInput(event.target.value, rollingDraft.maxQueueDays);
                  setRollingDraft((prev) => ({ ...prev, maxQueueDays: next }));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rolling-batch">Batch size</Label>
              <Input
                id="rolling-batch"
                type="number"
                min={1}
                value={rollingDraft.batchSize}
                onChange={(event) => {
                  const next = parseNumberInput(event.target.value, rollingDraft.batchSize);
                  setRollingDraft((prev) => ({ ...prev, batchSize: next }));
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => updateMutation.mutate({ rolling: rollingDraft })}
              disabled={updateMutation.isPending || !canEditStatus}
            >
              Save rolling settings
            </Button>
            <Button
              variant="outline"
              onClick={() => refreshRollingMutation.mutate()}
              disabled={refreshRollingMutation.isPending || !canEditStatus}
            >
              Refresh now
            </Button>
          </div>

          {rollingStatus ? (
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div className="text-muted-foreground">
                Days ahead: <span className="text-foreground">{rollingStatus.daysAhead}</span>
              </div>
              <div className="text-muted-foreground">
                Future posts:{' '}
                <span className="text-foreground">{rollingStatus.futurePostCount}</span>
              </div>
              <div className="text-muted-foreground">
                Missing slots:{' '}
                <span className="text-foreground">{rollingStatus.missingDates.length}</span>
              </div>
              <div className="text-muted-foreground">
                Active schedule runs:{' '}
                <span className="text-foreground">{rollingStatus.activeScheduleRuns}</span>
              </div>
              <div className="text-muted-foreground">
                Needs generation:{' '}
                <span className="text-foreground">
                  {rollingStatus.needsGeneration ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="text-muted-foreground">
                Next generation:{' '}
                <span className="text-foreground">
                  {rollingStatus.nextGenerationAt
                    ? new Date(rollingStatus.nextGenerationAt).toLocaleString()
                    : '—'}
                </span>
              </div>
              <div className="text-muted-foreground sm:col-span-2 lg:col-span-3">
                Generator:{' '}
                <span className="text-foreground">
                  {rollingStatus.generator
                    ? `Recipe version ${rollingStatus.generator.recipeTemplateVersionId}`
                    : 'Not configured (run this recipe once to seed generator source)'}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">
              Rolling status unavailable for this series.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="space-y-1">
          <CardTitle className="text-foreground text-base">Generations</CardTitle>
          <CardDescription className="text-muted-foreground">
            Executions that created or appended posts to this series.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {generations.length === 0 ? (
            <div className="text-muted-foreground text-sm">No generations recorded.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Recipe</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {generations.map((g) => (
                  <TableRow
                    key={g.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/runs/${g.id}`)}
                  >
                    <TableCell>
                      <Badge variant="outline">{g.status}</Badge>
                    </TableCell>
                    <TableCell className="text-foreground">{g.recipe?.name || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(g.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="space-y-1">
          <CardTitle className="text-foreground text-base">Posts</CardTitle>
          <CardDescription className="text-muted-foreground">
            Drafts and scheduled posts in this series.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {contents.length === 0 ? (
            <div className="text-muted-foreground text-sm">No posts in this series.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Caption</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contents.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-muted-foreground">
                      {c.scheduledAt
                        ? new Date(c.scheduledAt).toLocaleString()
                        : c.postedAt
                          ? new Date(c.postedAt).toLocaleString()
                          : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-foreground">
                      {String(c.caption || '').slice(0, 64) || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/posts/${c.id}`)}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
