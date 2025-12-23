import { useBrandStore } from '@/stores/brandStore';

import { AppEmptyState } from '@/components/AppEmptyState';
import { SocialAccountsManager } from '@/components/social/SocialAccountsManager';

export function SocialAccountsConnections() {
  const selectedBrand = useBrandStore((s) => s.selectedBrand);

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

  return <SocialAccountsManager brand={selectedBrand} />;
}
