import { memo, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  CalendarClock,
  Palette,
  Tag,
  Clock,
  Star,
  Pause,
  Play,
  Trash2,
  Loader2,
} from 'lucide-react';
import type { Campaign } from '../lib/api';
import { getStableColorFromId } from '../utils/campaign-colors';
import { getStoredCampaignColor } from '@/utils/campaign-color-storage';
// import { useNavigateWithFilters } from '@/hooks/useURLFilterSync';
import { getFrequencyLabel, getPriorityLabel, getStyleLabel } from '@/utils/campaign';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface CampaignCardProps {
  campaign: Campaign;
  onViewDetails: (campaignId: string) => void;
  onStartCampaign: (campaignId: string) => void;
  onPauseCampaign: (campaignId: string) => void;
  onDeleteCampaign: (campaignId: string, campaignName: string) => void;
  startCampaignLoading?: boolean;
  startCampaignLoadingId?: string | null;
  pauseCampaignLoading?: boolean;
  deleteCampaignLoading?: boolean;
}

const CampaignCard = memo(
  ({
    campaign,
    onViewDetails,
    onStartCampaign,
    onPauseCampaign,
    onDeleteCampaign,
    startCampaignLoading = false,
    startCampaignLoadingId = null,
    pauseCampaignLoading = false,
    deleteCampaignLoading = false,
  }: CampaignCardProps) => {
    // const goToContentWithFilters = useNavigateWithFilters();
    const apiColor = (campaign as any).color as string | undefined;
    const color = useMemo(() => {
      const stored = getStoredCampaignColor(campaign.id);
      return stored || apiColor || getStableColorFromId(campaign.id);
    }, [campaign, apiColor]);

    const canDeleteCampaign = () => {
      // Only campaigns with status: draft, preview, creating, failed can be deleted
      const deletableStatuses = ['draft', 'preview', 'creating', 'failed'];
      return deletableStatuses.includes(campaign.status);
    };

    const getDeleteTooltip = () => {
      if (canDeleteCampaign()) {
        return 'Delete campaign';
      }

      // Provide clear explanations for why campaigns cannot be deleted
      if (campaign.status === 'active') {
        return 'Active campaigns cannot be deleted. They contain published content and serve as historical records. Pause or wait for completion if you want to stop the campaign.';
      }

      if (campaign.status === 'paused') {
        return "Paused campaigns cannot be deleted. They may contain published content and can be resumed. Only campaigns that haven't started (draft, preview, creating, failed) can be deleted.";
      }

      if (campaign.status === 'completed') {
        return 'Completed campaigns cannot be deleted. They serve as historical records of your marketing activities and contain published content.';
      }

      if (campaign.status === 'processing') {
        return 'Campaigns being processed cannot be deleted. Wait for processing to complete or fail before attempting deletion.';
      }

      return `Campaigns with status "${campaign.status}" cannot be deleted. Only campaigns that haven't started (draft, preview, creating, failed) can be deleted.`;
    };

    const getStatusBadgeVariant = () => {
      switch (campaign.status) {
        case 'active':
          return 'success' as const;
        case 'paused':
          return 'warning' as const;
        case 'processing':
        case 'creating':
        case 'preview':
          return 'info' as const;
        case 'failed':
          return 'destructive' as const;
        default:
          return 'secondary' as const;
      }
    };

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
        default:
          return campaign.status;
      }
    };

    // Priority label helper removed (unused)

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

    const isLaunching = startCampaignLoading && startCampaignLoadingId === campaign.id;
    const launchTooltip = startCampaignLoading
      ? isLaunching
        ? 'Launching… We’re queuing new AI posts and placeholders.'
        : 'Another campaign is launching right now. Please wait a moment.'
      : 'Launch this campaign to start scheduling its AI posts.';

    return (
      <Card
        className="bg-card group relative cursor-pointer transition-all duration-200 hover:shadow-lg"
        onClick={() => onViewDetails(campaign.id)}
      >
        <CardContent className="p-6">
          {/* Removed campaign-colored tint overlay per design update */}
          <div className="min-w-0 flex-1">
            {/* Header with title, status and color dot */}
            <div className="mb-4 flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="inline-flex h-2.5 w-2.5 rounded-full"
                    style={{ background: color }}
                  />
                  <Badge variant={getStatusBadgeVariant()} className={`text-xs`}>
                    {getStatusLabel()}
                  </Badge>
                </div>
                <h3 className="text-foreground text-lg font-semibold transition-colors group-hover:underline">
                  {campaign.name}
                </h3>
              </div>

              {/* Quick actions - hover on desktop */}
              <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                {campaign.status === 'preview' && (
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartCampaign(campaign.id);
                          }}
                          disabled={startCampaignLoading}
                          className="px-3 py-1 text-xs"
                        >
                          {isLaunching ? (
                            <>
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              Launching…
                            </>
                          ) : (
                            <>
                              <Play className="mr-1 h-3 w-3" />
                              Launch
                            </>
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{launchTooltip}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                {campaign.status === 'active' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPauseCampaign(campaign.id);
                    }}
                    disabled={pauseCampaignLoading}
                    className="px-3 py-1 text-xs"
                  >
                    <Pause className="mr-1 h-3 w-3" />
                    Pause
                  </Button>
                )}

                {campaign.status === 'paused' && (
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartCampaign(campaign.id);
                    }}
                    disabled={startCampaignLoading}
                    className="px-3 py-1 text-xs"
                  >
                    <Play className="mr-1 h-3 w-3" />
                    Resume
                  </Button>
                )}

                {/* Calendar quick action removed to simplify UI */}

                {/* Delete action on hover */}
                <div className="group/delete relative">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canDeleteCampaign()) {
                        onDeleteCampaign(campaign.id, campaign.name);
                      }
                    }}
                    disabled={deleteCampaignLoading || !canDeleteCampaign()}
                    title={getDeleteTooltip()}
                    className={`px-2 py-1 text-xs transition-all ${
                      canDeleteCampaign()
                        ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
                        : 'text-muted-foreground cursor-not-allowed opacity-50 hover:bg-transparent'
                    }`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                  {/* Show tooltip on hover for disabled state */}
                  {!canDeleteCampaign() && (
                    <div className="bg-popover text-popover-foreground absolute right-0 bottom-full z-50 mb-2 hidden w-64 rounded-md p-2 text-xs shadow-lg group-hover/delete:block">
                      <div className="relative">
                        {getDeleteTooltip()}
                        <div
                          className="absolute top-full right-4 h-0 w-0 border-t-4 border-r-4 border-l-4 border-r-transparent border-l-transparent"
                          style={{ borderTopColor: 'var(--popover)' }}
                        ></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Info rows with icons: frequency, style, themes, posting time, priority */}
            <div className="mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <CalendarClock className="text-muted-foreground h-4 w-4" />
                <div className="text-muted-foreground">Frequency</div>
                <div className="text-foreground font-medium">
                  {getFrequencyLabel(campaign.config?.frequency || '—')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Palette className="text-muted-foreground h-4 w-4" />
                <div className="text-muted-foreground">Style</div>
                <div className="text-foreground font-medium">
                  {getStyleLabel(campaign.config?.style || '—')}
                </div>
              </div>
              <div className="sm:col-span-2">
                <div className="text-muted-foreground mb-1 flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Themes
                </div>
                <div className="flex flex-wrap gap-2">
                  {(campaign.config?.themes || []).length > 0 ? (
                    (campaign.config?.themes || []).map((t) => (
                      <Badge key={t} variant="secondary" className="whitespace-normal">
                        {t}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-foreground">—</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="text-muted-foreground h-4 w-4" />
                <div className="text-muted-foreground">Posting Time</div>
                <div className="text-foreground font-medium">
                  {campaign.config?.postingTime || '—'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Star className="text-muted-foreground h-4 w-4" />
                <div className="text-muted-foreground">Priority</div>
                <Badge variant="secondary" className="font-medium">
                  {getPriorityLabel(campaign.config?.priority ?? campaign.priority ?? 5)}
                </Badge>
              </div>
            </div>

            {/* Stats row */}
            <div className="text-muted-foreground mt-4 flex items-center justify-between text-sm">
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
  }
);

CampaignCard.displayName = 'CampaignCard';

export { CampaignCard };
