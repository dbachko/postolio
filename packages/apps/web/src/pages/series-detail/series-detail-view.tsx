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
import type {
  ContentSeries,
  GenerationSummary,
  RollingConfig,
  RollingStatus,
  SeriesContentItem,
} from './types';
import { parseNumberInput, statusBadgeVariant } from './utils';

interface SeriesDetailViewProps {
  navigate: (path: string) => void;
  openCalendar: (seriesId: string) => void;
  series: ContentSeries;
  generations: GenerationSummary[];
  contents: SeriesContentItem[];
  rollingStatus: RollingStatus | null;
  rollingDraft: RollingConfig;
  setRollingDraft: React.Dispatch<React.SetStateAction<RollingConfig>>;
  canEditStatus: boolean;
  nextPauseResume: { label: string; status: 'active' | 'paused' } | null;
  updateMutation: {
    mutate: (payload: { status?: ContentSeries['status']; rolling?: RollingConfig }) => void;
    isPending: boolean;
  };
  refreshRollingMutation: { mutate: () => void; isPending: boolean };
}

function SeriesHeader({
  series,
  navigate,
  openCalendar,
  canEditStatus,
  nextPauseResume,
  updateMutation,
}: Pick<
  SeriesDetailViewProps,
  'series' | 'navigate' | 'openCalendar' | 'canEditStatus' | 'nextPauseResume' | 'updateMutation'
>) {
  return (
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
        <Button variant="outline" onClick={() => openCalendar(series.id)}>
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
  );
}

function RollingGenerationCard({
  rollingDraft,
  setRollingDraft,
  canEditStatus,
  rollingStatus,
  updateMutation,
  refreshRollingMutation,
}: Pick<
  SeriesDetailViewProps,
  | 'rollingDraft'
  | 'setRollingDraft'
  | 'canEditStatus'
  | 'rollingStatus'
  | 'updateMutation'
  | 'refreshRollingMutation'
>) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="space-y-1">
        <CardTitle className="text-foreground text-base">Rolling generation</CardTitle>
        <CardDescription className="text-muted-foreground">
          Keep this series topped up with future drafts generated from its recipe source.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <RollingSettingsGrid rollingDraft={rollingDraft} setRollingDraft={setRollingDraft} />
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
          <RollingStatusMetrics rollingStatus={rollingStatus} />
        ) : (
          <div className="text-muted-foreground text-sm">
            Rolling status unavailable for this series.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RollingSettingsGrid({
  rollingDraft,
  setRollingDraft,
}: Pick<SeriesDetailViewProps, 'rollingDraft' | 'setRollingDraft'>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <div className="space-y-2">
        <Label htmlFor="rolling-enabled">Enabled</Label>
        <Switch
          id="rolling-enabled"
          checked={rollingDraft.enabled}
          onCheckedChange={(checked) =>
            setRollingDraft((prev) => ({ ...prev, enabled: Boolean(checked) }))
          }
        />
      </div>
      <RollingInputField
        id="rolling-min"
        label="Min queue days"
        value={rollingDraft.minQueueDays}
        onChange={(value) =>
          setRollingDraft((prev) => ({
            ...prev,
            minQueueDays: parseNumberInput(value, rollingDraft.minQueueDays),
          }))
        }
      />
      <RollingInputField
        id="rolling-target"
        label="Target queue days"
        value={rollingDraft.targetQueueDays}
        onChange={(value) =>
          setRollingDraft((prev) => ({
            ...prev,
            targetQueueDays: parseNumberInput(value, rollingDraft.targetQueueDays),
          }))
        }
      />
      <RollingInputField
        id="rolling-max"
        label="Max queue days"
        value={rollingDraft.maxQueueDays}
        onChange={(value) =>
          setRollingDraft((prev) => ({
            ...prev,
            maxQueueDays: parseNumberInput(value, rollingDraft.maxQueueDays),
          }))
        }
      />
      <RollingInputField
        id="rolling-batch"
        label="Batch size"
        value={rollingDraft.batchSize}
        onChange={(value) =>
          setRollingDraft((prev) => ({
            ...prev,
            batchSize: parseNumberInput(value, rollingDraft.batchSize),
          }))
        }
      />
    </div>
  );
}

function RollingInputField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function RollingStatusMetrics({ rollingStatus }: { rollingStatus: RollingStatus }) {
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div className="text-muted-foreground">
        Days ahead: <span className="text-foreground">{rollingStatus.daysAhead}</span>
      </div>
      <div className="text-muted-foreground">
        Future posts: <span className="text-foreground">{rollingStatus.futurePostCount}</span>
      </div>
      <div className="text-muted-foreground">
        Missing slots: <span className="text-foreground">{rollingStatus.missingDates.length}</span>
      </div>
      <div className="text-muted-foreground">
        Active schedule runs:{' '}
        <span className="text-foreground">{rollingStatus.activeScheduleRuns}</span>
      </div>
      <div className="text-muted-foreground">
        Needs generation:{' '}
        <span className="text-foreground">{rollingStatus.needsGeneration ? 'Yes' : 'No'}</span>
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
  );
}

function GenerationsCard({
  generations,
  navigate,
}: Pick<SeriesDetailViewProps, 'generations' | 'navigate'>) {
  return (
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
              {generations.map((generation) => (
                <TableRow
                  key={generation.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/runs/${generation.id}`)}
                >
                  <TableCell>
                    <Badge variant="outline">{generation.status}</Badge>
                  </TableCell>
                  <TableCell className="text-foreground">
                    {generation.recipe?.name || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(generation.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function PostsCard({ contents, navigate }: Pick<SeriesDetailViewProps, 'contents' | 'navigate'>) {
  return (
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
              {contents.map((content) => {
                let whenLabel = '—';
                if (content.scheduledAt) {
                  whenLabel = new Date(content.scheduledAt).toLocaleString();
                } else if (content.postedAt) {
                  whenLabel = new Date(content.postedAt).toLocaleString();
                }

                return (
                  <TableRow key={content.id}>
                    <TableCell className="text-muted-foreground">{whenLabel}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{content.status}</Badge>
                    </TableCell>
                    <TableCell className="text-foreground">
                      {String(content.caption || '').slice(0, 64) || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/posts/${content.id}`)}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function SeriesDetailView(props: SeriesDetailViewProps) {
  return (
    <div className="space-y-6">
      <SeriesHeader
        series={props.series}
        navigate={props.navigate}
        openCalendar={props.openCalendar}
        canEditStatus={props.canEditStatus}
        nextPauseResume={props.nextPauseResume}
        updateMutation={props.updateMutation}
      />
      <RollingGenerationCard
        rollingDraft={props.rollingDraft}
        setRollingDraft={props.setRollingDraft}
        canEditStatus={props.canEditStatus}
        rollingStatus={props.rollingStatus}
        updateMutation={props.updateMutation}
        refreshRollingMutation={props.refreshRollingMutation}
      />
      <GenerationsCard generations={props.generations} navigate={props.navigate} />
      <PostsCard contents={props.contents} navigate={props.navigate} />
    </div>
  );
}
