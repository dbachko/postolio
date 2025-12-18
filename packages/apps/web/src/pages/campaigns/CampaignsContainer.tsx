import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useBrandStore } from '@/stores/brandStore';
import { useCampaignsQueries } from '@/hooks/useCampaignsQueries';
import { useCampaignMutations } from '@/hooks/useCampaignMutations';
import { CampaignDashboard } from './CampaignDashboard';
import { CampaignCreate } from './CampaignCreate';
import { CampaignDetails } from './CampaignDetails';
import { AppEmptyState } from '@/components/AppEmptyState';

type View = 'dashboard' | 'create' | 'details';

export default function CampaignsContainer() {
  const { campaignId: urlCampaignId } = useParams<{ campaignId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const { selectedBrand } = useBrandStore();

  const getInitialView = () => {
    if (window.location.pathname === '/campaigns/create') return 'create' as View;
    if (urlCampaignId && urlCampaignId !== 'create') return 'details' as View;
    return 'dashboard' as View;
  };
  const [currentView, setCurrentView] = useState<View>(getInitialView);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    urlCampaignId || null
  );

  const { campaignsQuery, campaignDetailsQuery, limitsQuery } = useCampaignsQueries({
    selectedBrandId: selectedBrand?.id,
    urlCampaignId: selectedCampaignId || undefined,
    currentView,
  });

  const {
    startCampaignMutation,
    pauseCampaignMutation,
    deleteCampaignMutation,
    fillWindowMutation,
  } = useCampaignMutations(() => campaignsQuery.refetch());

  useEffect(() => {
    const pathname = location.pathname;
    if (pathname === '/campaigns' && !urlCampaignId) {
      setCurrentView('dashboard');
      setSelectedCampaignId(null);
    } else if (pathname === '/campaigns/create') {
      setCurrentView('create');
      setSelectedCampaignId(null);
    } else if (urlCampaignId && urlCampaignId !== 'create') {
      setSelectedCampaignId(urlCampaignId);
      setCurrentView('details');
    }
  }, [location.pathname, urlCampaignId]);

  const dashboard = (
    <CampaignDashboard
      campaigns={campaignsQuery.data?.campaigns}
      onViewCampaignDetails={(id) => navigate(`/campaigns/${id}`)}
    />
  );

  const create = <CampaignCreate brandId={selectedBrand?.id} />;

  const details = (
    <CampaignDetails
      campaign={campaignDetailsQuery.data?.campaign}
      isLoading={campaignDetailsQuery.isLoading}
      onStartCampaign={async () => {
        if (!selectedCampaignId) return;
        try {
          await startCampaignMutation.mutateAsync(selectedCampaignId);
          await campaignDetailsQuery.refetch();
        } catch {
          // toast is handled in the mutation hook
        }
      }}
      onPauseCampaign={async () => {
        if (!selectedCampaignId) return;
        try {
          await pauseCampaignMutation.mutateAsync(selectedCampaignId);
          await campaignDetailsQuery.refetch();
        } catch {
          // toast is handled in the mutation hook
        }
      }}
      limits={limitsQuery.data?.data}
      onUpdated={() => campaignDetailsQuery.refetch()}
      onFillWindow={async () => {
        if (!selectedCampaignId) return;
        await fillWindowMutation.mutateAsync(selectedCampaignId);
        await campaignDetailsQuery.refetch();
      }}
      fillWindowLoading={fillWindowMutation.isPending}
      startCampaignLoading={startCampaignMutation.isPending}
      startCampaignLoadingId={(startCampaignMutation.variables as string | undefined) || null}
      onDeleteCampaign={async () => {
        if (!selectedCampaignId) return;
        try {
          await deleteCampaignMutation.mutateAsync(selectedCampaignId);
          navigate('/campaigns');
        } catch {
          // toast is handled in the mutation hook
        }
      }}
      deleteCampaignLoading={deleteCampaignMutation.isPending}
    />
  );

  if (!selectedBrand) {
    return (
      <AppEmptyState
        variant="minimal"
        title="Set up a brand to run campaigns"
        description="Audience targeting, messaging, and AI automation all depend on a selected brand."
        actions={[{ label: 'Choose Brand', to: '/brands' }]}
      />
    );
  }

  if (currentView === 'create') return create;
  if (currentView === 'details') return details;
  return dashboard;
}
