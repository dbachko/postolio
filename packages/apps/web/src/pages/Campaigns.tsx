import { useState, useEffect, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { formatCompact } from '../lib/timezone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useBrandStore } from '../stores/brandStore';
import { apiClient, type Content, type Campaign } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { PostEditorModal } from '../components/PostEditorModal';
import { CampaignAnalytics } from '../components/CampaignAnalytics';
import { CampaignComparison } from '../components/CampaignComparison';
import { CampaignsList } from '../components/CampaignsList';
import { CampaignWizard } from '../components/campaign-wizard/CampaignWizard';
import { Skeleton } from '../components/ui/skeleton';
import { frequencyOptions, styleOptions } from '../constants/campaign';
import { useSchedulingWebSocket } from '../hooks/useSchedulingWebSocket';
import { useCampaignWizard } from '../hooks/useCampaignWizard';
import type {
  CampaignStatusUpdateData,
  CampaignErrorData,
  StatusUpdateEvent,
} from '../types/websocket';
import { Loader2, Calendar, Users, TrendingUp, AlertCircle, Plus, BarChart3 } from 'lucide-react';

// Helper function to check if campaign ID is valid (not 'create')
const isRealCampaignId = (campaignId: string | undefined): boolean => {
  return !!campaignId && campaignId !== 'create';
};

export function Campaigns() {
  const { campaignId: urlCampaignId } = useParams<{ campaignId?: string }>();
  const navigate = useNavigate();
  const { selectedBrand, setSelectedBrand, brands } = useBrandStore();
  const queryClient = useQueryClient();
  const resetWizard = useCampaignWizard((s) => s.reset);
  const setWizardBrandId = useCampaignWizard((s) => s.setBrandId);

  // Determine initial view based on URL
  const getInitialView = () => {
    if (window.location.pathname === '/campaigns/create') return 'create';
    if (urlCampaignId && urlCampaignId !== 'create') return 'details';
    return 'dashboard';
  };

  // View state management
  const [currentView, setCurrentView] = useState<'dashboard' | 'create' | 'details'>(
    getInitialView()
  );
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    urlCampaignId || null
  );

  // Modal state
  const [selectedPost, setSelectedPost] = useState<Content | null>(null);
  const [isPostEditorOpen, setIsPostEditorOpen] = useState(false);
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);

  // Status badge colors for generated content cards
  const getContentStatusBadgeClass = useMemo(() => {
    return (status: string) => {
      const classes: Record<string, string> = {
        draft: 'bg-gray-100 text-gray-700',
        scheduled: 'bg-blue-100 text-blue-700',
        published: 'bg-green-100 text-green-700',
        failed: 'bg-red-100 text-red-700',
        skipped: 'bg-gray-100 text-gray-700',
      };
      return classes[status] || 'bg-gray-100 text-gray-700';
    };
  }, []);

  // Campaign list query
  const campaignsQuery = useQuery<{ success: boolean; campaigns: Campaign[] }>({
    queryKey: ['campaigns', selectedBrand?.id],
    queryFn: () => apiClient.listCampaigns(selectedBrand?.id),
    enabled: !!selectedBrand,
  });

  // URL-accessed campaign query for auto brand-switching
  const urlCampaignQuery = useQuery<{ success: boolean; campaign: Campaign }>({
    queryKey: ['urlCampaign', urlCampaignId],
    queryFn: () => apiClient.getCampaign(urlCampaignId!),
    enabled: isRealCampaignId(urlCampaignId) && !!selectedBrand,
  });

  // Campaign details query for individual campaign view
  const campaignDetailsQuery = useQuery<{
    success: boolean;
    campaign: Campaign;
  }>({
    queryKey: ['campaign', selectedCampaignId],
    queryFn: () => apiClient.getCampaign(selectedCampaignId!),
    enabled: !!selectedCampaignId && currentView === 'details',
  });

  // Campaign mutations - moved here to avoid conditional hook calls

  const startCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.startCampaign(campaignId),
    onSuccess: () => {
      toast.success('Campaign started successfully!');
      campaignsQuery.refetch();
    },
    onError: (error) => {
      console.error('Failed to start campaign:', error);
      toast.error('Failed to start campaign. Please try again.');
    },
  });

  const pauseCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.updateCampaign(campaignId, { status: 'paused' }),
    onSuccess: (data) => {
      toast.success(data.message || 'Campaign paused successfully!');
      campaignsQuery.refetch();
    },
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.deleteCampaign(campaignId),
    onSuccess: () => {
      campaignsQuery.refetch();
      toast.success('Campaign deleted successfully');
    },
    onError: (error) => {
      console.error('Failed to delete campaign:', error);
      toast.error('Failed to delete campaign. Please try again.');
    },
  });

  // Handle URL changes and view state synchronization
  const location = useLocation();
  useEffect(() => {
    const pathname = location.pathname;

    // Check if we're at /campaigns (no specific campaign ID)
    if (pathname === '/campaigns' && !urlCampaignId) {
      setCurrentView('dashboard');
      setSelectedCampaignId(null);
    }
    // Check if we're at /campaigns/create
    else if (pathname === '/campaigns/create') {
      setCurrentView('create');
      setSelectedCampaignId(null);
    }
    // Check if we have a campaign ID in the URL
    else if (isRealCampaignId(urlCampaignId)) {
      setSelectedCampaignId(urlCampaignId!);
      setCurrentView('details');
    }
  }, [location.pathname, urlCampaignId, campaignsQuery.data?.campaigns]);

  // Editing via legacy form removed

  // Auto brand-switching effect when accessing campaign via URL
  useEffect(() => {
    if (isRealCampaignId(urlCampaignId) && urlCampaignQuery.data?.campaign) {
      const campaign = urlCampaignQuery.data.campaign;
      const campaignBrandId = campaign.brandId;

      // Check if we need to switch brands
      if (campaignBrandId && selectedBrand?.id !== campaignBrandId) {
        // Find the brand in our brands list
        const targetBrand = brands.find((brand) => brand.id === campaignBrandId);
        if (targetBrand) {
          setSelectedBrand(targetBrand);
          toast.info(`Switched to brand: ${targetBrand.name}`);
        }
      }
    }
  }, [urlCampaignId, urlCampaignQuery.data, selectedBrand, brands, setSelectedBrand]);

  // WebSocket handlers for real-time campaign updates
  const handleCampaignStatusUpdate = useCallback(
    (data: CampaignStatusUpdateData) => {
      console.log('Campaign status update:', data);

      // Update the campaigns query data with new status
      queryClient.setQueryData(
        ['campaigns', selectedBrand?.id],
        (oldData: { campaigns: Campaign[] } | undefined) => {
          if (!oldData) return oldData;

          const updatedCampaigns = oldData.campaigns.map((campaign: Campaign) =>
            campaign.id === data.campaignId
              ? {
                  ...campaign,
                  status: data.newStatus,
                  previewGenerated: data.previewGenerated,
                  errorMessage: data.errorMessage,
                }
              : campaign
          );

          return { ...oldData, campaigns: updatedCampaigns };
        }
      );

      // Show notifications for important status changes
      const campaignName =
        campaignsQuery.data?.campaigns?.find((c) => c.id === data.campaignId)?.name || 'Campaign';
      if (data.newStatus === 'preview') {
        toast.success(`${campaignName} is ready to launch!`);
      } else if (data.newStatus === 'completed') {
        toast.success(`${campaignName} completed successfully!`);
      } else if (data.newStatus === 'failed') {
        toast.error(`${campaignName} generation failed: ${data.errorMessage}`);
      }

      // If viewing this campaign's details, refetch to populate content as it arrives
      if (currentView === 'details' && selectedCampaignId === data.campaignId) {
        campaignDetailsQuery.refetch();
      }
    },
    [
      queryClient,
      selectedBrand?.id,
      campaignsQuery.data?.campaigns,
      currentView,
      selectedCampaignId,
      campaignDetailsQuery,
    ]
  );

  // Removed campaign progress handler; we no longer track campaign-level percent

  const handleCampaignError = useCallback(
    (data: CampaignErrorData) => {
      console.error('Campaign error:', data);

      const campaignName =
        campaignsQuery.data?.campaigns?.find((c) => c.id === data.campaignId)?.name || 'Campaign';
      toast.error(`${campaignName} Error`, {
        description: data.errorMessage,
        duration: 8000,
      });
    },
    [campaignsQuery.data?.campaigns]
  );

  // Handle content-level status updates: if they belong to the selected campaign in details view, refetch
  const handleStatusUpdateWS = useCallback(
    (event: StatusUpdateEvent) => {
      const items = Array.isArray(event.data) ? event.data : [event.data];
      const hasSelectedCampaignContent = items.some((d) => {
        const meta = d?.metadata as { campaignId?: string } | undefined;
        return meta?.campaignId && meta.campaignId === selectedCampaignId;
      });
      if (currentView === 'details' && hasSelectedCampaignContent) {
        campaignDetailsQuery.refetch();
      }
    },
    [currentView, selectedCampaignId, campaignDetailsQuery]
  );

  // Initialize WebSocket connection for real-time updates
  useSchedulingWebSocket({
    enabled: !!selectedBrand,
    onStatusUpdate: handleStatusUpdateWS,
    onCampaignStatusUpdate: handleCampaignStatusUpdate,
    onCampaignError: handleCampaignError,
  });

  // Memoized campaigns data to prevent unnecessary re-renders
  const campaigns = useMemo(
    () => campaignsQuery.data?.campaigns || [],
    [campaignsQuery.data?.campaigns]
  );

  // Event handlers with useCallback for performance
  const handleStartCampaign = useCallback(
    (campaignId: string) => {
      // Check if this is a resume operation (campaign is paused)
      const campaign = campaigns.find((c) => c.id === campaignId);
      if (campaign?.status === 'paused') {
        // Resume the paused campaign
        apiClient
          .updateCampaign(campaignId, { status: 'active' })
          .then((data) => {
            if (data.skippedCount && data.skippedCount > 0) {
              toast.info(
                data.message ||
                  `Campaign resumed. ${data.skippedCount} scheduled posts were skipped.`
              );
            } else {
              toast.success(data.message || 'Campaign resumed successfully!');
            }
            campaignsQuery.refetch();
          })
          .catch((error) => {
            console.error('Failed to resume campaign:', error);
            toast.error('Failed to resume campaign. Please try again.');
          });
      } else {
        // Normal start for preview campaigns
        startCampaignMutation.mutate(campaignId);
      }
    },
    [startCampaignMutation, campaigns, campaignsQuery]
  );

  const handlePauseCampaign = useCallback(
    (campaignId: string) => {
      pauseCampaignMutation.mutate(campaignId);
    },
    [pauseCampaignMutation]
  );

  const handleDeleteCampaign = useCallback(
    (campaignId: string, campaignName?: string) => {
      const confirmMessage = campaignName
        ? `Are you sure you want to delete the campaign "${campaignName}"? This action cannot be undone.`
        : 'Are you sure you want to delete this campaign? This action cannot be undone.';

      if (confirm(confirmMessage)) {
        deleteCampaignMutation.mutate(campaignId);
      }
    },
    [deleteCampaignMutation]
  );

  // Editing disabled during wizard rollout

  const handleViewCampaignDetails = useCallback(
    (campaignId: string) => {
      navigate(`/campaigns/${campaignId}`);
    },
    [navigate]
  );

  const handleCreateNewCampaign = useCallback(() => {
    resetWizard();
    if (selectedBrand) setWizardBrandId(selectedBrand.id);
    setCurrentView('create');
    navigate('/campaigns/create');
  }, [navigate, resetWizard, selectedBrand, setWizardBrandId]);

  // Campaign edit hook
  // Legacy edit flow removed

  if (!selectedBrand) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Please select a brand to access campaign features</AlertDescription>
      </Alert>
    );
  }

  // Helper functions for labels retained for details view only

  const getFrequencyLabel = (frequency: string) => {
    const option = frequencyOptions.find((opt) => opt.value === frequency);
    return option ? option.label : frequency;
  };

  const getStyleLabel = (style: string) => {
    const option = styleOptions.find((opt) => opt.value === style);
    return option ? option.label : style;
  };

  const getCampaignCardVariant = (status: string) => {
    switch (status) {
      case 'preview':
        return 'preview';
      case 'active':
        return 'active';
      case 'failed':
        return 'failed';
      case 'creating':
      case 'processing':
        return 'creating';
      case 'paused':
        return 'paused';
      default:
        return 'default';
    }
  };

  // Event handlers

  const handleEditPost = (post: Content) => {
    setSelectedPost(post);
    setIsPostEditorOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
        <p className="mt-1 text-gray-600">
          {currentView === 'dashboard'
            ? `Manage automated content campaigns for ${selectedBrand.name}`
            : currentView === 'create'
              ? `Create new automated content campaign for ${selectedBrand.name}`
              : `View campaign details for ${selectedBrand.name}`}
        </p>
      </div>

      {/* Dashboard View */}
      {currentView === 'dashboard' && (
        <>
          {/* Action Header */}
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4">
                <div className="space-y-1">
                  <CardTitle>Campaign Management</CardTitle>
                  <CardDescription>
                    Monitor active campaigns and manage your content pipeline
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsComparisonOpen(true)}
                    disabled={
                      !campaigns.length ||
                      campaigns.filter((c) => ['active', 'completed', 'paused'].includes(c.status))
                        .length < 2
                    }
                    className="flex items-center gap-2"
                  >
                    <BarChart3 className="h-4 w-4" />
                    Compare Campaigns
                  </Button>
                  <Button onClick={handleCreateNewCampaign} className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Create New Campaign
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Campaign Dashboard */}
          {campaignsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="ml-2">Loading campaigns...</span>
            </div>
          ) : campaignsQuery.error ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Failed to load campaigns. Please try again.</AlertDescription>
            </Alert>
          ) : !campaigns.length ? (
            <div className="py-12 text-center">
              <div className="mb-4">
                <Calendar className="mx-auto h-12 w-12 text-gray-400" />
              </div>
              <h3 className="mb-2 text-lg font-medium text-gray-900">No campaigns yet</h3>
              <p className="mb-4 text-gray-600">
                Create your first automated content campaign to get started.
              </p>
              <div className="flex justify-center gap-2">
                <Button onClick={handleCreateNewCampaign} className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Create New Campaign
                </Button>
              </div>
            </div>
          ) : (
            <CampaignsList
              campaigns={campaigns}
              onViewCampaignDetails={handleViewCampaignDetails}
              onStartCampaign={handleStartCampaign}
              onPauseCampaign={handlePauseCampaign}
              onDeleteCampaign={handleDeleteCampaign}
              // onEditCampaign removed during wizard rollout
              startCampaignLoading={startCampaignMutation.isPending}
              pauseCampaignLoading={pauseCampaignMutation.isPending}
              deleteCampaignLoading={deleteCampaignMutation.isPending}
            />
          )}
        </>
      )}

      {/* Create Campaign View */}
      {currentView === 'create' && <CampaignWizard />}

      {/* Edit view removed */}

      {/* Campaign Details View */}
      {currentView === 'details' && campaignDetailsQuery.data?.campaign && (
        <>
          {/* Campaign Details Header */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Campaign Details</CardTitle>
                  <CardDescription>
                    View campaign configuration and generated content
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCurrentView('dashboard');
                      setSelectedCampaignId(null);
                      navigate('/campaigns', { replace: true });
                    }}
                  >
                    ← All Campaigns
                  </Button>
                  {/* Edit disabled during wizard rollout */}
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Campaign Overview */}
          {(() => {
            const campaign = campaignDetailsQuery.data.campaign;
            const config = campaign.config || {
              duration: { start: '', end: '' },
              frequency: '',
              style: '',
              themes: [],
              postingTime: '',
            };

            return (
              <>
                <Card variant={getCampaignCardVariant(campaign.status)}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>{campaign.name}</CardTitle>
                        <CardDescription>Campaign overview and metrics</CardDescription>
                      </div>
                      <Badge
                        variant={
                          campaign.status === 'active'
                            ? 'default'
                            : campaign.status === 'preview'
                              ? 'default'
                              : campaign.status === 'paused'
                                ? 'outline'
                                : 'secondary'
                        }
                      >
                        {campaign.status === 'preview' ? 'ready to launch' : campaign.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                      <Card>
                        <CardContent className="flex items-center gap-3 p-4">
                          <Calendar className="h-5 w-5 text-blue-600" />
                          <div>
                            <p className="text-muted-foreground text-sm">Duration</p>
                            <p className="font-semibold">
                              {config.duration?.start && config.duration?.end
                                ? Math.ceil(
                                    (new Date(config.duration.end).getTime() -
                                      new Date(config.duration.start).getTime()) /
                                      (1000 * 60 * 60 * 24)
                                  )
                                : 'N/A'}{' '}
                              days
                            </p>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardContent className="flex items-center gap-3 p-4">
                          <TrendingUp className="h-5 w-5 text-green-600" />
                          <div>
                            <p className="text-muted-foreground text-sm">Content Created</p>
                            <p className="font-semibold">{campaign.content?.length || 0} posts</p>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardContent className="flex items-center gap-3 p-4">
                          <Users className="h-5 w-5 text-purple-600" />
                          <div>
                            <p className="text-muted-foreground text-sm">Frequency</p>
                            <p className="font-semibold">
                              {config.frequency ? getFrequencyLabel(config.frequency) : 'N/A'}
                            </p>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardContent className="flex items-center gap-3 p-4">
                          <div className="h-5 w-5 rounded-full bg-orange-600" />
                          <div>
                            <p className="text-muted-foreground text-sm">Style</p>
                            <p className="font-semibold">
                              {config.style ? getStyleLabel(config.style) : 'N/A'}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                      <div>
                        <h3 className="mb-2 font-medium">Campaign Details</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Start Date:</span>
                            <span className="font-medium">
                              {config.duration?.start
                                ? format(new Date(config.duration.start), 'MMM d, yyyy')
                                : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">End Date:</span>
                            <span className="font-medium">
                              {config.duration?.end
                                ? format(new Date(config.duration.end), 'MMM d, yyyy')
                                : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Posting Time:</span>
                            <span className="font-medium">{config.postingTime || 'N/A'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Priority:</span>
                            <span className="font-medium">
                              {campaign.priority === 1
                                ? '🔴 Urgent (1)'
                                : campaign.priority === 2
                                  ? '🟠 High (2)'
                                  : campaign.priority === 3
                                    ? '🟡 Medium-High (3)'
                                    : campaign.priority === 4
                                      ? '🟢 Medium (4)'
                                      : campaign.priority === 5
                                        ? '🔵 Normal (5)'
                                        : campaign.priority === 6
                                          ? '⚪ Low (6)'
                                          : campaign.priority === 7
                                            ? '⚫ Very Low (7)'
                                            : `Priority ${campaign.priority || 5}`}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Created:</span>
                            <span className="font-medium">
                              {format(new Date(campaign.createdAt), 'MMM d, yyyy')}
                            </span>
                          </div>
                          {campaign.startedAt && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Started:</span>
                              <span className="font-medium">
                                {format(new Date(campaign.startedAt), 'MMM d, yyyy')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <h3 className="mb-2 font-medium">Content Themes</h3>
                        <div className="flex flex-wrap gap-2">
                          {config.themes?.map((theme: string, index: number) => (
                            <Badge key={index} variant="secondary">
                              {theme}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Start Campaign Button for preview_ready campaigns */}
                {campaign.status === 'preview' && (
                  <Card>
                    <CardContent className="flex items-center justify-between p-6">
                      <div>
                        <CardTitle className="text-lg">Ready to Launch?</CardTitle>
                        <CardDescription className="mt-1">
                          Your campaign preview is ready. Start the campaign to begin automated
                          content posting.
                        </CardDescription>
                      </div>
                      <Button
                        onClick={() => {
                          if (campaign.id) {
                            startCampaignMutation.mutate(campaign.id);
                          }
                        }}
                        disabled={startCampaignMutation.isPending}
                        className="bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700"
                      >
                        {startCampaignMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Starting Campaign...
                          </>
                        ) : (
                          'Start Campaign'
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Campaign Analytics */}
                {(campaign.status === 'active' ||
                  campaign.status === 'completed' ||
                  campaign.status === 'paused') && (
                  <CampaignAnalytics campaignId={campaign.id} campaignName={campaign.name} />
                )}

                {/* Campaign Content */}
                <Card>
                  <CardHeader>
                    <CardTitle>Generated Content</CardTitle>
                    <CardDescription>
                      {campaign.content?.length || 0} posts generated for this campaign
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!campaign.content || campaign.content.length === 0 ? (
                      <>
                        {['creating', 'processing'].includes(campaign.status) ? (
                          // Show skeletons while content is being generated
                          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                            {[...Array(6)].map((_, i) => (
                              <div key={i} className="overflow-hidden rounded-lg border bg-white">
                                <Skeleton className="h-48 w-full" />
                                <div className="space-y-3 p-4">
                                  <Skeleton className="h-5 w-24" />
                                  <Skeleton className="h-4 w-full" />
                                  <Skeleton className="h-4 w-5/6" />
                                  <Skeleton className="h-8 w-full" />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="py-8 text-center">
                            <div className="mb-4">
                              <Calendar className="mx-auto h-12 w-12 text-gray-400" />
                            </div>
                            <h3 className="mb-2 text-lg font-medium text-gray-900">
                              No content generated yet
                            </h3>
                            <p className="text-gray-600">
                              {campaign.status === 'preview'
                                ? 'Start this campaign to begin automated content posting.'
                                : 'Content will appear here as it gets generated.'}
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        {campaign.content.map((post: Content) => (
                          <Card key={post.id}>
                            {post.imageUrl && (
                              <div className="aspect-w-16 aspect-h-9">
                                <img
                                  src={post.imageUrl || ''}
                                  alt={`Post ${post.id}`}
                                  className="h-48 w-full rounded-t-lg object-cover"
                                />
                              </div>
                            )}

                            <CardContent className="p-4">
                              <div className="mb-3">
                                <div className="mb-2 flex items-center gap-2">
                                  {(post as any)?.generationParams?.processing?.active ? (
                                    <Badge variant="secondary" className="gap-1">
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                      Scheduling...
                                    </Badge>
                                  ) : (
                                    <Badge className={getContentStatusBadgeClass(post.status)}>
                                      {post.status.charAt(0).toUpperCase() + post.status.slice(1)}
                                    </Badge>
                                  )}
                                  {(() => {
                                    const displayTime =
                                      post.status === 'published'
                                        ? post.postedAt
                                        : post.scheduledAt;
                                    return displayTime ? (
                                      <span className="text-muted-foreground text-xs">
                                        {formatCompact(displayTime, 'MMM d, h:mm a')}
                                      </span>
                                    ) : null;
                                  })()}
                                </div>
                                <p
                                  className="overflow-hidden text-sm leading-relaxed"
                                  style={{
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: 'vertical',
                                  }}
                                >
                                  {post.caption}
                                </p>
                              </div>

                              {post.hashtags && post.hashtags.length > 0 && (
                                <div className="mb-4">
                                  <div className="flex flex-wrap gap-1">
                                    {post.hashtags
                                      .slice(0, 3)
                                      .map((tag: string, tagIndex: number) => (
                                        <Badge
                                          key={tagIndex}
                                          variant="secondary"
                                          className="text-xs"
                                        >
                                          #{tag}
                                        </Badge>
                                      ))}
                                    {post.hashtags.length > 3 && (
                                      <span className="text-muted-foreground text-xs">
                                        +{post.hashtags.length - 3} more
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}

                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditPost(post)}
                                  disabled={post.status === 'published'}
                                  title={
                                    post.status === 'published'
                                      ? 'Cannot edit published content'
                                      : 'Edit this post'
                                  }
                                  className="flex-1"
                                >
                                  Edit
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            );
          })()}
        </>
      )}

      {/* Loading states */}
      {campaignDetailsQuery.isLoading && currentView === 'details' && (
        <Card>
          <CardContent className="flex items-center justify-center py-8">
            <Loader2 className="mr-2 h-6 w-6 animate-spin" />
            Loading campaign details...
          </CardContent>
        </Card>
      )}

      {campaignDetailsQuery.error && currentView === 'details' && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Failed to load campaign details. Please try again.</AlertDescription>
        </Alert>
      )}

      {/* Post Editor Modal */}
      <PostEditorModal
        content={selectedPost}
        isOpen={isPostEditorOpen}
        onClose={() => {
          setIsPostEditorOpen(false);
          setSelectedPost(null);
        }}
      />

      {/* Campaign Comparison Modal */}
      <CampaignComparison
        campaigns={campaigns}
        isOpen={isComparisonOpen}
        onClose={() => setIsComparisonOpen(false)}
      />
    </div>
  );
}
//
