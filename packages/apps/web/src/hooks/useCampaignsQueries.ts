import { useQuery } from '@tanstack/react-query';
import {
  campaign as campaignApi,
  content as contentApi,
  brand as brandApi,
  type Campaign,
} from '@/lib/api';

interface Args {
  selectedBrandId?: string;
  urlCampaignId?: string;
  currentView: 'dashboard' | 'create' | 'details';
}

export function useCampaignsQueries({ selectedBrandId, urlCampaignId, currentView }: Args) {
  const campaignsQuery = useQuery<{ success: boolean; campaigns: Campaign[] }>({
    queryKey: ['campaigns', selectedBrandId],
    queryFn: () => campaignApi.listCampaigns(selectedBrandId),
    enabled: !!selectedBrandId,
  });

  const limitsQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead'],
    queryFn: () => campaignApi.getScheduleAheadLimit(),
    staleTime: 60 * 1000,
  });

  const instagramStatusQuery = useQuery({
    queryKey: ['instagram-status', selectedBrandId],
    queryFn: () => brandApi.getSocialConnectionStatus(selectedBrandId!, 'instagram'),
    enabled: !!selectedBrandId,
    refetchOnWindowFocus: true,
  });

  const urlCampaignQuery = useQuery<{ success: boolean; campaign: Campaign }>({
    queryKey: ['urlCampaign', urlCampaignId],
    queryFn: () => campaignApi.getCampaign(urlCampaignId!),
    enabled: !!urlCampaignId && urlCampaignId !== 'create' && !!selectedBrandId,
  });

  const campaignDetailsQuery = useQuery<{
    success: boolean;
    campaign: Campaign;
  }>({
    queryKey: ['campaign', urlCampaignId],
    queryFn: () => campaignApi.getCampaign(urlCampaignId!),
    enabled: !!urlCampaignId && currentView === 'details',
  });

  const placeholdersQuery = useQuery({
    queryKey: ['campaign-placeholders', urlCampaignId],
    enabled: !!urlCampaignId && currentView === 'details' && !!campaignDetailsQuery.data?.campaign,
    queryFn: async () => {
      const camp = campaignDetailsQuery.data!.campaign;
      const brandId = camp.brandId!;
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const y2 = next.getFullYear();
      const m2 = String(next.getMonth() + 1).padStart(2, '0');
      const curRes = await contentApi.getCalendarContent(brandId, `${y}-${m}`);
      const nextRes = await contentApi.getCalendarContent(brandId, `${y2}-${m2}`);
      const placeholders = [
        ...(curRes?.data?.placeholders || []),
        ...(nextRes?.data?.placeholders || []),
      ];
      return placeholders.filter((p: any) => p.campaignId === camp.id);
    },
  });

  return {
    campaignsQuery,
    limitsQuery,
    instagramStatusQuery,
    urlCampaignQuery,
    campaignDetailsQuery,
    placeholdersQuery,
  };
}
