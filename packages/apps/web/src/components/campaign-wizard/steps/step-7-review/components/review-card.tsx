import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { goalEmoji } from '@/utils/goal-emojis';

interface ReviewSummary {
  type: string;
  name: string;
  goals: string[];
  timeline: any;
  themes: string[];
  style: any;
  frequency: any;
  postingTime: any;
  seasonalityAssist: boolean;
}

interface ReviewCardProps {
  summary: ReviewSummary;
  onEditType: () => void;
  onToggleSeasonality: (value: boolean) => void;
  onEditGoals: () => void;
  onEditTimeline: () => void;
  onEditThemes: () => void;
}

export function ReviewCard({
  summary,
  onEditType,
  onToggleSeasonality,
  onEditGoals,
  onEditTimeline,
  onEditThemes,
}: ReviewCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-muted-foreground">Campaign Type</div>
            <div className="font-medium capitalize">{summary.type.replace('_', ' ')}</div>
          </div>
          <Button variant="outline" onClick={onEditType}>
            Edit
          </Button>
        </div>
        <div className="bg-muted h-px w-full" />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-muted-foreground">Seasonality Assistance</div>
            <div className="text-muted-foreground">
              Use seasons/holidays in content when relevant
            </div>
          </div>
          <Switch checked={summary.seasonalityAssist} onCheckedChange={onToggleSeasonality} />
        </div>
        <div className="bg-muted h-px w-full" />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-muted-foreground">Campaign Goals</div>
            {summary.goals.length ? (
              <ol className="text-muted-foreground mt-1 space-y-1 pl-0">
                {summary.goals.map((g, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Badge variant="secondary" className="min-w-6 justify-center px-2 py-0 text-xs">
                      {i + 1}
                    </Badge>
                    <span>
                      <span aria-hidden className="mr-1">
                        {goalEmoji(g)}
                      </span>
                      {g}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="text-muted-foreground">No specific goals set</div>
            )}
          </div>
          <Button variant="outline" onClick={onEditGoals}>
            Edit
          </Button>
        </div>
        <div className="bg-muted h-px w-full" />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-muted-foreground">Timeline & Posting</div>
            <div className="font-medium">
              {summary.timeline?.startDate || '—'} → {summary.timeline?.endDate || '—'}
            </div>
            <div className="text-muted-foreground">
              {summary.frequency || '—'} • {summary.postingTime || '—'}
            </div>
          </div>
          <Button variant="outline" onClick={onEditTimeline}>
            Edit
          </Button>
        </div>
        <div className="bg-muted h-px w-full" />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-muted-foreground">Themes & Style</div>
            <div className="mb-1 flex flex-wrap gap-1">
              {summary.themes.map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
            </div>
            <div className="text-muted-foreground">
              {Array.isArray(summary.style) && summary.style.length > 0
                ? summary.style.join('; ')
                : '—'}
            </div>
          </div>
          <Button variant="outline" onClick={onEditThemes}>
            Edit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
