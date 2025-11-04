import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { useBrandStore } from '../stores/brandStore';
import { Card, CardContent } from '@/components/ui/card';
import AssetLibrary from '@/features/assets/components/AssetLibrary';

export function Assets() {
  const { selectedBrand } = useBrandStore();
  const [error] = useState<string | null>(null);

  if (!selectedBrand) {
    return (
      <div className="container mx-auto p-6">
        <PageHeader title="Asset Library" description="Manage your images and videos" />
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Please select a brand to view its assets.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
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
    <div className="container mx-auto p-6">
      <PageHeader
        title="Asset Library"
        description="Manage your images and videos for content creation"
      />
      <AssetLibrary brandId={selectedBrand.id} />
    </div>
  );
}
