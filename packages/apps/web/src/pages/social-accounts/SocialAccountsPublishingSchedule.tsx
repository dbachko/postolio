import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { AppEmptyState } from '@/components/app-empty-state';
import { useBrandStore } from '@/stores/brandStore';
import { PublishingScheduleContent } from './publishing-schedule/publishing-schedule-content';
import { PublishingScheduleDialogs } from './publishing-schedule/publishing-schedule-dialogs';
import { usePublishingSchedulePageModel } from './publishing-schedule/use-publishing-schedule-page-model';

export function SocialAccountsPublishingSchedule() {
  const queryClient = useQueryClient();
  const selectedBrand = useBrandStore((store) => store.selectedBrand);
  const { contentProps, dialogProps } = usePublishingSchedulePageModel({
    selectedBrandId: selectedBrand?.id,
    queryClient,
  });

  if (!selectedBrand) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AppEmptyState
          variant="minimal"
          title="Select a brand to manage social accounts"
          description="Choose which brand you want to manage to connect accounts and configure a publishing schedule."
          actions={[{ label: 'Choose Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  return (
    <Card>
      <PublishingScheduleContent {...contentProps} />
      <PublishingScheduleDialogs {...dialogProps} />
    </Card>
  );
}
