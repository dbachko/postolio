import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Loader2, Calendar, TrendingUp, Pause, Play, Trash2, Activity } from 'lucide-react';
import { formatCompact } from '../lib/timezone';
import { useTimezone } from '../contexts/TimezoneContext';
import type { Campaign } from '../lib/api';

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
    const { timezone } = useTimezone();
    const navigate = useNavigate();

    const getBorderColor = () => {
      switch (campaign.status) {
        case 'active':
          return '#22c55e';
        case 'preview':
          return '#3b82f6';
        case 'creating':
        case 'processing':
          return '#f59e0b';
        case 'failed':
          return '#ef4444';
        case 'paused':
          return '#6b7280';
        default:
          return '#e5e7eb';
      }
    };

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

    const getPriorityLabel = (priority: number) => {
      switch (priority) {
        case 1:
          return '🔴 Urgent';
        case 2:
          return '🟠 High';
        case 3:
          return '🟡 Med-High';
        case 4:
          return '🟢 Medium';
        case 5:
          return '🔵 Normal';
        case 6:
          return '⚪ Low';
        case 7:
          return '⚫ Very Low';
        default:
          return `Priority ${priority}`;
      }
    };

    const getDurationInDays = () => {
      if (!campaign.config?.duration) return 'No duration';
      const start = new Date(campaign.config.duration.start);
      const end = new Date(campaign.config.duration.end);
      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      return `${days} days`;
    };

    return (
      <Card
        className="group cursor-pointer border-l-4 bg-white transition-all duration-200 hover:border-l-blue-500 hover:shadow-lg"
        style={{ borderLeftColor: getBorderColor() }}
        onClick={() => onViewDetails(campaign.id)}
      >
        <CardContent className="p-6">
          <div className="min-w-0 flex-1">
            {/* Header with title and status */}
            <div className="mb-4 flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-semibold text-gray-900 transition-colors group-hover:text-blue-600">
                  {campaign.name}
                </h3>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant={getBadgeVariant()} className="text-xs">
                    {getStatusLabel()}
                  </Badge>

                  {/* Content count indicator */}
                  {campaign.content && campaign.content.length > 0 && (
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">
                      {campaign.content.length} posts
                    </span>
                  )}
                </div>
              </div>

              {/* Quick actions - only show on hover and for relevant states */}
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
                    navigate(`/content?campaigns=${campaign.id}`);
                  }}
                  className="px-2 py-1 text-xs text-blue-500 hover:text-blue-700"
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

            {/* Indeterminate state for creating/processing campaigns (no percentage) */}
            {(campaign.status === 'creating' || campaign.status === 'processing') && (
              <div className="mb-4">
                <div className="mb-2 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <span className="text-sm text-gray-600">Generating content…</span>
                </div>
              </div>
            )}

            {/* Error message for failed campaigns */}
            {campaign.status === 'failed' && campaign.errorMessage && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-600">
                  <span className="font-medium">Error:</span> {campaign.errorMessage}
                </p>
              </div>
            )}

            {/* Campaign details grid */}
            <div className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
              <div className="flex items-center gap-2 text-gray-600">
                <TrendingUp className="h-4 w-4 text-gray-400" />
                <span className="font-medium">{campaign.config?.frequency || 'N/A'}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <Calendar className="h-4 w-4 text-gray-400" />
                <span>{getDurationInDays()}</span>
              </div>
              {campaign.startedAt && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Activity className="h-4 w-4 text-gray-400" />
                  <span>Started {formatCompact(campaign.startedAt, 'MMM d', timezone)}</span>
                </div>
              )}
              {campaign.priority && campaign.priority !== 5 && (
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-xs">{getPriorityLabel(campaign.priority)}</span>
                </div>
              )}
            </div>

            {/* Themes preview */}
            {campaign.config?.themes && campaign.config.themes.length > 0 && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="flex flex-wrap gap-1">
                  {campaign.config.themes.slice(0, 3).map((theme: string, index: number) => (
                    <span
                      key={index}
                      className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700"
                    >
                      {theme}
                    </span>
                  ))}
                  {campaign.config.themes.length > 3 && (
                    <span className="px-2 py-1 text-xs text-gray-500">
                      +{campaign.config.themes.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }
);

CampaignCard.displayName = 'CampaignCard';

export { CampaignCard };
