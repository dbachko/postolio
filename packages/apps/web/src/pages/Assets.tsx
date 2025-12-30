import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useBrandStore } from '../stores/brandStore';
import AssetLibrary from '@/features/assets/components/AssetLibrary';
import { AppEmptyState } from '@/components/app-empty-state';
import { Card, CardContent } from '@/components/ui/card';

export function Assets() {
  const { selectedBrand } = useBrandStore();
  const [error] = useState<string | null>(null);

  if (!selectedBrand) {
    return (
      <div className="mx-auto w-full">
        <PageHeader title="Asset Library" description="Manage your images and videos" />
        <AppEmptyState
          variant="minimal"
          title="Choose a brand to view assets"
          description="Assets are organized per brand. Pick one to browse, upload, or reuse creative."
          actions={[{ label: 'Go to Brands', to: '/brands' }]}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full">
        <PageHeader title="Asset Library" description="Manage your images and videos" />
        <Card>
          <CardContent className="p-6">
            <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-4">
              <h3 className="text-destructive mb-2 font-semibold">Service Not Available</h3>
              <p className="text-muted-foreground text-sm">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full">
      <PageHeader title="Asset Library" />
      <AssetLibrary brandId={selectedBrand.id} />
    </div>
  );
}
