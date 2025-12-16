import { memo, useMemo, type CSSProperties } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarClock, Palette, Tag, Clock } from 'lucide-react';
import type { Campaign } from '../lib/api';
import { getStableColorFromId } from '../utils/campaign-colors';
import { getStoredCampaignColor } from '@/utils/campaign-color-storage';
// import { useNavigateWithFilters } from '@/hooks/useURLFilterSync';
import { getFrequencyLabel, getStyleLabel } from '@/utils/campaign';

interface CampaignCardProps {
  campaign: Campaign;
  onViewDetails: (campaignId: string) => void;
}

const STATUS_COLORS: Partial<Record<Campaign['status'], string>> = {
  // Theme-aware tokens from shadcn (`src/index.css`); avoids hard-coded palette values.
  active: 'var(--success)',
  completed: 'var(--muted-foreground)',
  paused: 'var(--warning)',
  failed: 'var(--destructive)',
  processing: 'var(--info)',
  creating: 'var(--chart-2)',
  preview: 'var(--action-purple)',
};

const CampaignCard = memo(({ campaign, onViewDetails }: CampaignCardProps) => {
  // const goToContentWithFilters = useNavigateWithFilters();
  const apiColor = (campaign as any).color as string | undefined;
  const color = useMemo(() => {
    const stored = getStoredCampaignColor(campaign.id);
    return stored || apiColor || getStableColorFromId(campaign.id);
  }, [campaign, apiColor]);

  const titleStyle = useMemo(() => ({ '--campaign-color': color }) as CSSProperties, [color]);
  const statusStyle = useMemo(() => {
    const base = STATUS_COLORS[campaign.status] || 'var(--muted-foreground)';
    return {
      '--status-color': base,
      // Use srgb mixing for more predictable hues across browsers.
      borderColor: `color-mix(in srgb, ${base} 55%, var(--border))`,
      backgroundColor: `color-mix(in srgb, ${base} 18%, var(--background))`,
      color: `color-mix(in srgb, ${base} 75%, var(--foreground))`,
    } as CSSProperties;
  }, [campaign.status]);

  const getStatusLabel = () => {
    switch (campaign.status) {
      case 'creating':
        return 'Generating';
      case 'preview':
        return 'Ready';
      case 'processing':
        return 'Processing';
      case 'active':
        return 'Active';
      case 'paused':
        return 'Paused';
      case 'failed':
        return 'Failed';
      case 'completed':
        return 'Completed';
      default:
        return campaign.status;
    }
  };

  const scheduledCount = useMemo(() => {
    const fromCounts = (campaign as any).scheduledCount;
    if (typeof fromCounts === 'number') return fromCounts;
    if (Array.isArray(campaign.content)) {
      return campaign.content.filter((c: any) => c.status === 'scheduled').length;
    }
    return undefined;
  }, [campaign]);

  const totalCount = useMemo(() => {
    const fromCounts = (campaign as any).contentCount;
    if (typeof fromCounts === 'number') return fromCounts;
    return Array.isArray(campaign.content) ? campaign.content.length : undefined;
  }, [campaign]);

  return (
    <Card
      className="bg-card group hover:bg-muted/30 relative cursor-pointer transition-colors"
      onClick={() => onViewDetails(campaign.id)}
    >
      <CardContent className="p-4">
        {/* Removed campaign-colored tint overlay per design update */}
        <div className="relative min-w-0 flex-1">
          {/* Header */}
          <div className="mb-3 flex flex-wrap items-center gap-2 pr-20">
            <span
              className="bg-muted/30 border-border relative inline-flex max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-full border px-3 py-1 transition-colors group-hover:border-[var(--campaign-color)] before:absolute before:inset-0 before:z-0 before:bg-[var(--campaign-color)] before:opacity-0 before:transition-[clip-path,opacity] before:duration-500 before:ease-out before:content-[''] before:[clip-path:circle(0px_at_12px_50%)] group-hover:before:opacity-25 group-hover:before:[clip-path:circle(220%_at_12px_50%)]"
              style={titleStyle}
            >
              <span
                className="relative z-10 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: 'var(--campaign-color)' }}
              />
              <span className="text-foreground relative z-10 truncate text-sm font-semibold">
                {campaign.name}
              </span>
            </span>
          </div>
          <Badge
            variant="outline"
            style={statusStyle}
            className="absolute top-0 right-0 shrink-0 text-xs font-semibold"
          >
            {getStatusLabel()}
          </Badge>

          {/* Info rows with icons: frequency, style, themes, posting time */}
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <div className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              <span className="text-foreground font-medium">
                {getFrequencyLabel(campaign.config?.frequency || '—')}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              <span className="text-foreground font-medium">
                {campaign.config?.postingTime || '—'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Palette className="h-3.5 w-3.5" />
              <span className="text-foreground font-medium">
                {getStyleLabel(campaign.config?.style || '—')}
              </span>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-2">
            <Tag className="text-muted-foreground mt-0.5 h-3.5 w-3.5" />
            <div className="flex flex-wrap gap-1.5">
              {(campaign.config?.themes || []).length > 0 ? (
                <>
                  {(campaign.config?.themes || []).slice(0, 4).map((t) => (
                    <Badge key={t} variant="secondary" className="px-2 py-0.5 text-xs">
                      {t}
                    </Badge>
                  ))}
                  {(campaign.config?.themes || []).length > 4 ? (
                    <Badge variant="secondary" className="px-2 py-0.5 text-xs">
                      +{(campaign.config?.themes || []).length - 4}
                    </Badge>
                  ) : null}
                </>
              ) : (
                <span className="text-foreground text-xs">—</span>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="text-muted-foreground mt-3 flex items-center justify-between text-xs">
            <div>
              <span className="font-medium">{scheduledCount ?? '—'}</span> scheduled
              <span className="text-muted-foreground/60 mx-2">•</span>
              <span className="font-medium">{totalCount ?? '—'}</span> posts
            </div>
          </div>
          {campaign.status === 'paused' && (
            <p className="text-muted-foreground mt-2 text-xs">
              Paused campaigns don&apos;t generate or schedule new posts until resumed.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

CampaignCard.displayName = 'CampaignCard';

export { CampaignCard };
