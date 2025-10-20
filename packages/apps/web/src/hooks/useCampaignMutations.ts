import { useMutation } from '@tanstack/react-query';
import { campaign as campaignApi } from '@/lib/api';
import { toast } from 'sonner';

export function useCampaignMutations(refetchCampaigns: () => void) {
  const startCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => campaignApi.startCampaign(campaignId),
    onSuccess: () => {
      toast.success('Campaign started successfully!');
      refetchCampaigns();
    },
    onError: (error) => {
      console.error('Failed to start campaign:', error);
      toast.error('Failed to start campaign. Please try again.');
    },
  });

  const pauseCampaignMutation = useMutation({
    mutationFn: (campaignId: string) =>
      campaignApi.updateCampaign(campaignId, { status: 'paused' }),
    onSuccess: (data: any) => {
      toast.success(data.message || 'Campaign paused successfully!');
      refetchCampaigns();
    },
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => campaignApi.deleteCampaign(campaignId),
    onSuccess: () => {
      refetchCampaigns();
      toast.success('Campaign deleted successfully');
    },
    onError: (error) => {
      console.error('Failed to delete campaign:', error);
      toast.error('Failed to delete campaign. Please try again.');
    },
  });

  return { startCampaignMutation, pauseCampaignMutation, deleteCampaignMutation };
}
