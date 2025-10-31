import { Suspense, lazy, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { useBrandStore } from '../stores/brandStore';
import { Card, CardContent } from '@/components/ui/card';

// Dynamically import the AssetLibrary from the remote module
const AssetLibrary = lazy(() => import('assetLibrary/AssetLibrary'));

export function Assets() {
  const { selectedBrand } = useBrandStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if the assets microservice is running
    const checkAssetsService = async () => {
      try {
        const response = await fetch('http://localhost:3001/assets/remoteEntry.js', {
          method: 'HEAD',
        });
        if (!response.ok) {
          setError(
            'Assets microservice is not running. Please start it with: pnpm --filter=@postolio/assets dev'
          );
        }
      } catch (_err) {
        setError(
          'Assets microservice is not running. Please start it with: pnpm --filter=@postolio/assets dev'
        );
      }
    };

    checkAssetsService();
  }, []);

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
      <Suspense
        fallback={
          <Card>
            <CardContent className="p-6">
              <div className="flex h-64 items-center justify-center">
                <div className="text-center">
                  <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
                  <p className="text-muted-foreground mt-4">Loading Asset Library...</p>
                </div>
              </div>
            </CardContent>
          </Card>
        }
      >
        {/* @ts-expect-error - Remote module from Module Federation */}
        <AssetLibrary brandId={selectedBrand.id} />
      </Suspense>
    </div>
  );
}
