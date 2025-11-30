import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pause, Play, Edit, Calendar, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { CampaignAnalytics } from '@/components/CampaignAnalytics';
import PreferredPostingTime from '@/components/PreferredPostingTime';
import { CampaignEditDialog } from '@/components/CampaignEditDialog';
import { ContentCard } from '@/components/ContentCard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { Campaign } from '@/lib/api';
import { useEffect, useState } from 'react';
import { useTimezone } from '@/contexts/TimezoneContext';
import { useNavigateWithFilters } from '@/hooks/useURLFilterSync';
// Week 3: Enhanced campaign analytics components
import { CampaignTimeline } from '@/components/analytics/CampaignTimeline';
import { useQuery } from '@tanstack/react-query';
import { campaign as campaignApi } from '@/lib/api';

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
  const { timezone: userTz, getBrandTimezone } = useTimezone();
  const [brandTimezone, setBrandTimezone] = useState<string>(userTz);
  const goToContentWithFilters = useNavigateWithFilters();
  // Must be declared before any early returns to keep hooks order stable
  const [editOpen, setEditOpen] = useState(false);

  // Week 3: Fetch enhanced campaign metrics
  const metricsQuery = useQuery({
    queryKey: ['campaign-metrics-enhanced', campaign?.id],
    queryFn: () => campaignApi.getCampaignMetrics(campaign!.id),
    enabled: !!campaign?.id,
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!campaign?.brandId) return;
      try {
        const tz = await getBrandTimezone(campaign.brandId);
        if (mounted && tz) setBrandTimezone(tz);
      } catch {
        if (mounted) setBrandTimezone(userTz);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [campaign?.brandId, getBrandTimezone, userTz]);
  const renderSkeletonGrid = (count = 6) => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-card overflow-hidden rounded-lg shadow-md">
          <Skeleton className="h-48 w-full" />
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-5/6" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-12" />
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-8 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

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
          <CardContent>{renderSkeletonGrid(6)}</CardContent>
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
          <CampaignAnalytics
            campaignId={campaign.id}
            campaignName={campaign.name}
            timezone={brandTimezone}
          />
        </CardContent>
      </Card>

      {/* Week 3: Campaign Timeline */}
      {metricsQuery.data?.data?.postsTimeline &&
        metricsQuery.data.data.postsTimeline.length > 0 && (
          <CampaignTimeline
            posts={metricsQuery.data.data.postsTimeline}
            startDate={campaign.createdAt}
            endDate={undefined}
            loading={metricsQuery.isLoading}
            onPostClick={(contentId) => {
              window.location.href = `/content/${contentId}`;
            }}
          />
        )}

      {/* Preferred Posting Times for this brand */}
      <PreferredPostingTime brandId={campaign.brandId} />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Posts</CardTitle>
            {!capacityFull && (!campaign.content || campaign.content.length === 0) && (
              <Button
                size="sm"
                onClick={onFillWindow}
                disabled={!!fillWindowLoading}
                className="gap-2"
              >
                {fillWindowLoading ? 'Filling…' : 'Fill Window'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isGenerating ? (
            renderSkeletonGrid(6)
          ) : Array.isArray(campaign.content) && campaign.content.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {campaign.content.map((item) => (
                <ContentCard key={item.id} content={item as any} brandId={campaign.brandId} />
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground py-6 text-center text-sm">
              No posts yet for this campaign
            </div>
          )}
        </CardContent>
      </Card>
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
