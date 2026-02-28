import { useNavigate } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import type { RunArtifact, RunStep } from '@/lib/api/runs-client';

function jsonPretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function artifactTitle(artifact: RunArtifact): string {
  if (artifact.kind === 'asset') {
    return artifact.assetId ? `${artifact.name} (${artifact.assetId})` : artifact.name;
  }
  return artifact.name;
}

function stepDuration(step: RunStep): string | null {
  if (!step.startedAt || !step.finishedAt) {
    return null;
  }
  const ms = new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return null;
  }
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function CreatedContentCard({
  createdContent,
  onOpenPost,
  onOpenSeries,
  onOpenCalendar,
}: {
  createdContent: { contentSeriesId: string | null; contentIds: string[] };
  onOpenPost: (id: string) => void;
  onOpenSeries: (id: string) => void;
  onOpenCalendar: () => void;
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="space-y-1">
        <CardTitle className="text-foreground text-base">Created content</CardTitle>
        <div className="text-muted-foreground text-xs">
          Series: <span className="font-mono">{createdContent.contentSeriesId || '—'}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {createdContent.contentIds.length === 0 ? (
          <div className="text-muted-foreground text-sm">No content ids recorded.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {createdContent.contentIds.map((id) => (
              <Button key={id} variant="outline" size="sm" onClick={() => onOpenPost(id)}>
                {id.slice(0, 8)}
              </Button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          {createdContent.contentSeriesId ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenSeries(createdContent.contentSeriesId!)}
            >
              Open series
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onOpenCalendar}>
            Open calendar
          </Button>
        </div>
        <div className="text-muted-foreground text-xs">
          Tip: open the calendar and filter by the series to see the full schedule.
        </div>
      </CardContent>
    </Card>
  );
}

function RunArtifactCard({
  artifact,
  onOpenAsset,
}: {
  artifact: RunArtifact;
  onOpenAsset: (id: string) => void;
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="space-y-1">
        <CardTitle className="text-foreground text-sm">{artifactTitle(artifact)}</CardTitle>
        <div className="text-muted-foreground text-xs">{artifact.kind}</div>
      </CardHeader>
      <CardContent className="space-y-3">
        {artifact.kind === 'asset' ? (
          <div className="space-y-2">
            <div className="text-muted-foreground text-sm">
              Asset ID: <span className="font-mono">{artifact.assetId || '—'}</span>
            </div>
            {artifact.assetId ? (
              <Button variant="outline" size="sm" onClick={() => onOpenAsset(artifact.assetId!)}>
                View asset
              </Button>
            ) : null}
          </div>
        ) : (
          <pre className="bg-muted text-foreground max-h-[420px] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
            {artifact.contentText || '—'}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

export function OutputTab({
  data,
  createdContent,
  artifactsByKind,
}: {
  data: any;
  createdContent: { contentSeriesId: string | null; contentIds: string[] } | null;
  artifactsByKind: Record<string, RunArtifact[]>;
}) {
  const navigate = useNavigate();
  return (
    <TabsContent value="output" className="space-y-4">
      {createdContent ? (
        <CreatedContentCard
          createdContent={createdContent}
          onOpenPost={(id) => navigate(`/posts/${id}`)}
          onOpenSeries={(id) => navigate(`/series/${id}`)}
          onOpenCalendar={() => navigate('/content')}
        />
      ) : null}

      {data.artifacts.length === 0 ? (
        <div className="text-muted-foreground text-sm">No artifacts yet.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {Object.values(artifactsByKind)
            .flat()
            .map((artifact) => (
              <RunArtifactCard
                key={artifact.id}
                artifact={artifact}
                onOpenAsset={(assetId) => navigate(`/assets/${assetId}`)}
              />
            ))}
        </div>
      )}
    </TabsContent>
  );
}

export function TraceTab({ data }: { data: any }) {
  return (
    <TabsContent value="trace" className="space-y-3">
      {data.steps.length === 0 ? (
        <div className="text-muted-foreground text-sm">No steps yet.</div>
      ) : (
        <div className="space-y-3">
          {data.steps.map((step: RunStep) => (
            <details key={step.id} className="bg-card border-border rounded-md border p-4">
              <summary className="text-foreground flex cursor-pointer list-none items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Badge variant="outline">{step.status}</Badge>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{step.name}</div>
                    <div className="text-muted-foreground truncate text-xs">{step.type}</div>
                  </div>
                </div>
                <div className="text-muted-foreground text-xs">{stepDuration(step) || ''}</div>
              </summary>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="text-muted-foreground mb-1 text-xs">Input</div>
                  <pre className="bg-muted text-foreground max-h-[320px] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                    {jsonPretty(step.inputJsonRedacted)}
                  </pre>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1 text-xs">Output</div>
                  <pre className="bg-muted text-foreground max-h-[320px] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                    {jsonPretty(step.outputJsonRedacted)}
                  </pre>
                </div>
              </div>
              {step.errorMessage ? (
                <div className="text-destructive mt-3 text-sm">{step.errorMessage}</div>
              ) : null}
            </details>
          ))}
        </div>
      )}
    </TabsContent>
  );
}

export function InputsTab({ data }: { data: any }) {
  return (
    <TabsContent value="inputs" className="space-y-3">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-base">Inputs</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted text-foreground overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
            {jsonPretty(data.run.input)}
          </pre>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

export function CostTab({ data }: { data: any }) {
  return (
    <TabsContent value="cost" className="space-y-3">
      <Card className="bg-card border-border">
        <CardHeader className="space-y-1">
          <CardTitle className="text-foreground text-sm">Cost summary</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-1 text-sm">
          <div>Total input tokens: {data.costSummary?.totalInputTokens ?? 0}</div>
          <div>Total output tokens: {data.costSummary?.totalOutputTokens ?? 0}</div>
          <div>Total estimated cost: {data.costSummary?.totalEstimatedCostUsd || '—'}</div>
          <div>Managed credits spent: {data.costSummary?.managedCreditsSpent ?? 0}</div>
        </CardContent>
      </Card>

      {data.costs.length === 0 ? (
        <div className="text-muted-foreground text-sm">No cost data yet.</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.costs.map((cost: any) => (
            <Card key={cost.id} className="bg-card border-border">
              <CardHeader className="space-y-1">
                <CardTitle className="text-foreground text-sm">
                  {cost.provider} · {cost.mode}
                </CardTitle>
                <div className="text-muted-foreground text-xs">{cost.notes || '—'}</div>
              </CardHeader>
              <CardContent className="text-muted-foreground space-y-1 text-sm">
                <div>Input tokens: {cost.inputTokens}</div>
                <div>Output tokens: {cost.outputTokens}</div>
                <div>Estimated cost: {cost.estimatedCostUsd || '—'}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </TabsContent>
  );
}
