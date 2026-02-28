import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';

import { BrandProfileSidebarContent } from './brand-profile/brand-profile-sidebar-content';
import { useBrandProfileSidebarState } from './brand-profile/use-brand-profile-sidebar-state';

export function BrandProfileSidebar({ id }: { id?: string }) {
  const { close } = useRightSidebarRouter();
  const brandId = id || null;
  const state = useBrandProfileSidebarState(brandId);

  return (
    <BrandProfileSidebarContent
      brandId={brandId}
      loading={state.loading}
      error={state.error}
      reRunLoading={state.reRunLoading}
      reRunMessage={state.reRunMessage}
      profile={state.profile}
      freezeCore={state.freezeCore}
      freezeLoading={state.freezeLoading}
      onClose={close}
      onReRun={state.handleReRun}
      onToggleFreeze={state.toggleFreeze}
    />
  );
}
