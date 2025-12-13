import { useMutation, useQueryClient } from '@tanstack/react-query';
import { campaign as campaignApi } from '@/lib/api';
import { toast } from 'sonner';

export function useCampaignMutations(refetchCampaigns: () => void) {
  const queryClient = useQueryClient();

  const startCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => campaignApi.startCampaign(campaignId),
    onSuccess: (data: any, campaignId) => {
      const updatedCampaign =
        data && typeof data === 'object' && 'campaign' in data ? (data as any).campaign : null;

      // Ensure details view flips to "Pause" immediately (avoid stale GET caches / timing issues).
      if (updatedCampaign && typeof updatedCampaign === 'object') {
        queryClient.setQueryData(['campaign', campaignId], (old: any) => {
          if (old && typeof old === 'object' && 'campaign' in old) {
            return { ...old, campaign: { ...(old as any).campaign, ...updatedCampaign } };
          }
          return { success: true, campaign: updatedCampaign };
        });
        queryClient.setQueryData(['urlCampaign', campaignId], (old: any) => {
          if (old && typeof old === 'object' && 'campaign' in old) {
            return { ...old, campaign: { ...(old as any).campaign, ...updatedCampaign } };
          }
          return { success: true, campaign: updatedCampaign };
        });
      } else {
        // Fallback: still force a refresh of the campaign detail query.
        queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
        queryClient.invalidateQueries({ queryKey: ['urlCampaign', campaignId] });
      }

      toast.success(data?.message || 'Campaign started successfully!');
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
    onSuccess: (data: any, campaignId) => {
      toast.success(data.message || 'Campaign paused successfully!');
      const updatedCampaign =
        data && typeof data === 'object' && 'campaign' in data ? (data as any).campaign : null;

      if (updatedCampaign && typeof updatedCampaign === 'object') {
        queryClient.setQueryData(['campaign', campaignId], (old: any) => {
          if (old && typeof old === 'object' && 'campaign' in old) {
            return { ...old, campaign: { ...(old as any).campaign, ...updatedCampaign } };
          }
          return { success: true, campaign: updatedCampaign };
        });
        queryClient.setQueryData(['urlCampaign', campaignId], (old: any) => {
          if (old && typeof old === 'object' && 'campaign' in old) {
            return { ...old, campaign: { ...(old as any).campaign, ...updatedCampaign } };
          }
          return { success: true, campaign: updatedCampaign };
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
        queryClient.invalidateQueries({ queryKey: ['urlCampaign', campaignId] });
      }
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

  const fillWindowMutation = useMutation({
    mutationFn: (campaignId: string) => campaignApi.fillCampaignWindow(campaignId),
    onSuccess: (res: any) => {
      const generated = res?.generated ?? res?.scheduledPosts ?? 0;
      const msg =
        res?.message ||
        (generated > 0
          ? `Filled scheduling window with ${generated} post${generated === 1 ? '' : 's'}.`
          : 'No new posts were generated (window already filled).');
      toast.success(msg);
      refetchCampaigns();
    },
    onError: (error) => {
      console.error('Failed to fill window:', error);
      toast.error('Failed to fill window. Please try again.');
    },
  });

  return {
    startCampaignMutation,
    pauseCampaignMutation,
    deleteCampaignMutation,
    fillWindowMutation,
  };
}
