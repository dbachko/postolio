import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pause, Play, Edit, Calendar, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { CampaignAnalytics } from '@/components/CampaignAnalytics';
import { CampaignEditDialog } from '@/components/CampaignEditDialog';
import { CampaignPostsGrid } from '@/components/CampaignPostsGrid';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { Campaign } from '@/lib/api';
import { useState } from 'react';
import { useNavigateWithFilters } from '@/hooks/useURLFilterSync';

interface Props {
  campaign?: Campaign;
  isLoading: boolean;
  onStartCampaign?: () => void;
  onPauseCampaign?: () => void;
  onFillWindow?: () => void;
  fillWindowLoading?: boolean;
  limits?: { tier: string; maxAllowed: number; currentCount: number };
  onUpdated?: () => void; // called after saving edits
  startCampaignLoading?: boolean;
  startCampaignLoadingId?: string | null;
}

export function CampaignDetails({
  campaign,
  isLoading,
  onStartCampaign,
  onPauseCampaign,
  onFillWindow,
  fillWindowLoading,
  limits,
  onUpdated,
  startCampaignLoading = false,
  startCampaignLoadingId = null,
}: Props) {
  const goToContentWithFilters = useNavigateWithFilters();
  // Must be declared before any early returns to keep hooks order stable
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-6 w-48" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-6 w-24" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[460px] w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!campaign) return null;
  const isLaunching = startCampaignLoading && startCampaignLoadingId === campaign.id;
  const capacityFull =
    !!limits && Number.isFinite(limits.maxAllowed) && limits.currentCount >= limits.maxAllowed;
  const isGenerating =
    (!campaign.content || campaign.content.length === 0) &&
    (campaign.status === 'creating' ||
      campaign.status === 'processing' ||
      (campaign.status === 'preview' && !campaign.previewGenerated)) &&
    !capacityFull;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{campaign.name}</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => goToContentWithFilters({ campaigns: [campaign.id] })}
                title="View this campaign in the calendar"
              >
                <Calendar className="h-4 w-4" />
                View Calendar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => setEditOpen(true)}
              >
                <Edit className="h-4 w-4" />
                Edit
              </Button>
              {campaign.status === 'preview' && (
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={onStartCampaign}
                  disabled={startCampaignLoading}
                >
                  {isLaunching ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Launching…
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Launch
                    </>
                  )}
                </Button>
              )}
              {campaign.status === 'active' && (
                <Button size="sm" variant="outline" className="gap-2" onClick={onPauseCampaign}>
                  <Pause className="h-4 w-4" />
                  Pause
                </Button>
              )}
              {campaign.status === 'paused' && (
                <Button size="sm" className="gap-2" onClick={onStartCampaign}>
                  <Play className="h-4 w-4" />
                  Resume
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {campaign.status === 'paused' && (
            <Alert variant="warning" className="mb-3">
              <AlertDescription>
                This campaign is paused. No new posts will be generated or scheduled until you
                resume it.
              </AlertDescription>
            </Alert>
          )}
          {capacityFull && (!campaign.content || campaign.content.length === 0) && (
            <Alert>
              <AlertDescription>
                You’ve reached your account’s scheduling capacity ({limits?.currentCount}/
                {Number.isFinite(limits?.maxAllowed) ? limits?.maxAllowed : '∞'}). Free up slots by
                publishing or removing future drafts, or upgrade your plan. Then click Fill Window
                to generate posts for this campaign.
              </AlertDescription>
            </Alert>
          )}
          <CampaignAnalytics campaignId={campaign.id} />
        </CardContent>
      </Card>

      <CampaignPostsGrid
        posts={campaign.content ?? []}
        isGenerating={isGenerating}
        action={
          !capacityFull && (!campaign.content || campaign.content.length === 0) ? (
            <Button
              size="sm"
              onClick={onFillWindow}
              disabled={!!fillWindowLoading}
              className="gap-2"
            >
              {fillWindowLoading ? 'Filling…' : 'Fill Window'}
            </Button>
          ) : null
        }
      />
      <CampaignEditDialog
        campaign={campaign}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => {
          onUpdated?.();
        }}
      />
    </div>
  );
}
