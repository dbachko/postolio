import { memo, useMemo } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Calendar, Pause, Play, Trash2 } from 'lucide-react';
import type { Campaign } from '../lib/api';
import { getStableColorFromId } from '../utils/campaign-colors';
import { getStoredCampaignColor } from '@/utils/campaign-color-storage';
import { useNavigateWithFilters } from '@/hooks/useURLFilterSync';

interface CampaignCardProps {
  campaign: Campaign;
  onViewDetails: (campaignId: string) => void;
  onStartCampaign: (campaignId: string) => void;
  onPauseCampaign: (campaignId: string) => void;
  onDeleteCampaign: (campaignId: string, campaignName: string) => void;
  startCampaignLoading?: boolean;
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
    pauseCampaignLoading = false,
    deleteCampaignLoading = false,
  }: CampaignCardProps) => {
    const goToContentWithFilters = useNavigateWithFilters();
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

    const getBadgeVariant = () => {
      switch (campaign.status) {
        case 'active':
        case 'preview':
          return 'default';
        case 'creating':
        case 'processing':
          return 'secondary';
        case 'failed':
          return 'destructive';
        case 'paused':
          return 'outline';
        default:
          return 'secondary';
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

    const scheduledCount = useMemo(
      () =>
        Array.isArray(campaign.content)
          ? campaign.content.filter((c: any) => c.status === 'scheduled').length
          : undefined,
      [campaign.content]
    );

    const totalCount = Array.isArray(campaign.content) ? campaign.content.length : undefined;

    return (
      <Card
        className="group cursor-pointer border-l-4 bg-white transition-all duration-200 hover:shadow-lg"
        style={{ borderLeftColor: color }}
        onClick={() => onViewDetails(campaign.id)}
      >
        <CardContent className="p-6">
          <div className="min-w-0 flex-1">
            {/* Header with title, status and color dot */}
            <div className="mb-4 flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="inline-flex h-2.5 w-2.5 rounded-full"
                    style={{ background: color }}
                  />
                  <Badge variant={getBadgeVariant()} className="text-xs">
                    {getStatusLabel()}
                  </Badge>
                </div>
                <h3 className="truncate text-lg font-semibold text-gray-900 transition-colors group-hover:text-blue-600">
                  {campaign.name}
                </h3>
              </div>

              {/* Quick actions - hover on desktop */}
              <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                {campaign.status === 'preview' && (
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartCampaign(campaign.id);
                    }}
                    disabled={startCampaignLoading}
                    className="bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700"
                  >
                    <Play className="mr-1 h-3 w-3" />
                    Launch
                  </Button>
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
                    className="bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700"
                  >
                    <Play className="mr-1 h-3 w-3" />
                    Resume
                  </Button>
                )}

                {/* View in Calendar */}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    goToContentWithFilters({ campaigns: [campaign.id] });
                  }}
                  className="px-2 py-1 text-xs text-blue-600 hover:text-blue-700"
                  title="View in calendar"
                >
                  <Calendar className="h-3 w-3" />
                </Button>

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
                        ? 'text-red-500 hover:bg-red-50 hover:text-red-700'
                        : 'cursor-not-allowed text-gray-300 opacity-50 hover:bg-transparent'
                    }`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                  {/* Show tooltip on hover for disabled state */}
                  {!canDeleteCampaign() && (
                    <div className="absolute bottom-full right-0 z-50 mb-2 hidden w-64 rounded-md bg-gray-900 p-2 text-xs text-white shadow-lg group-hover/delete:block">
                      <div className="relative">
                        {getDeleteTooltip()}
                        <div className="absolute right-4 top-full h-0 w-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900"></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Info grid: frequency, style, themes */}
            <div className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-3">
              <div>
                <div className="text-gray-500">Frequency</div>
                <div className="font-medium text-gray-800">{campaign.config?.frequency || '—'}</div>
              </div>
              <div>
                <div className="text-gray-500">Style</div>
                <div className="font-medium text-gray-800">{campaign.config?.style || '—'}</div>
              </div>
              <div className="col-span-2 lg:col-span-1">
                <div className="text-gray-500">Themes</div>
                <div className="truncate text-gray-800">
                  {(campaign.config?.themes || []).length > 0
                    ? (campaign.config?.themes || []).slice(0, 4).join(', ')
                    : '—'}
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="mt-3 flex items-center justify-between text-sm text-gray-700">
              <div>
                <span className="font-medium">{scheduledCount ?? '—'}</span> scheduled
                <span className="mx-2 text-gray-300">•</span>
                <span className="font-medium">{totalCount ?? '—'}</span> posts
                <Button
                  size="sm"
                  variant="link"
                  className="ml-2 h-auto p-0 text-blue-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    goToContentWithFilters({ campaigns: [campaign.id] });
                  }}
                >
                  View on calendar
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
);

CampaignCard.displayName = 'CampaignCard';

export { CampaignCard };
