import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useBrandStore } from '@/stores/brandStore';
import { useCampaignsQueries } from '@/hooks/useCampaignsQueries';
import { campaign as campaignApi } from '@/lib/api';
import { useCampaignMutations } from '@/hooks/useCampaignMutations';
import { CampaignDashboard } from './CampaignDashboard';
import { CampaignCreate } from './CampaignCreate';
import { CampaignDetails } from './CampaignDetails';

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

  const { startCampaignMutation, pauseCampaignMutation, deleteCampaignMutation } =
    useCampaignMutations(() => campaignsQuery.refetch());

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
      onStartCampaign={(id) => startCampaignMutation.mutate(id)}
      onPauseCampaign={(id) => pauseCampaignMutation.mutate(id)}
      onDeleteCampaign={(id, _name) => deleteCampaignMutation.mutate(id)}
      startCampaignLoading={startCampaignMutation.isPending}
      pauseCampaignLoading={pauseCampaignMutation.isPending}
      deleteCampaignLoading={deleteCampaignMutation.isPending}
    />
  );

  const create = <CampaignCreate brandId={selectedBrand?.id} />;

  const details = (
    <CampaignDetails
      campaign={campaignDetailsQuery.data?.campaign}
      isLoading={campaignDetailsQuery.isLoading}
      onStartCampaign={() => selectedCampaignId && startCampaignMutation.mutate(selectedCampaignId)}
      onPauseCampaign={() => selectedCampaignId && pauseCampaignMutation.mutate(selectedCampaignId)}
      limits={limitsQuery.data?.data}
      onUpdated={() => campaignDetailsQuery.refetch()}
      onFillWindow={async () => {
        if (!selectedCampaignId) return;
        try {
          await campaignApi.fillCampaignWindow(selectedCampaignId);
          await campaignDetailsQuery.refetch();
        } catch (e) {
          console.error('fill-window failed', e);
        }
      }}
    />
  );

  return currentView === 'create' ? create : currentView === 'details' ? details : dashboard;
}
