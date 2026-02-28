import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { brand as brandApi } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';

import {
  CostOptimizationTips,
  ImageAnalyticsHeader,
  ImageAnalyticsOverviewCards,
  ProviderPerformanceCard,
  RecentGenerationsCard,
} from './image-analytics/image-analytics-sections';
import type { ImageAnalyticsData } from './image-analytics/types';

export default function ImageAnalytics() {
  const { selectedBrand } = useBrandStore();
  const [dateRange] = useState<{ startDate?: string; endDate?: string }>({});

  const query = useQuery({
    queryKey: ['imageAnalytics', selectedBrand?.id, dateRange],
    queryFn: () => (selectedBrand ? brandApi.getImageAnalytics(selectedBrand.id, dateRange) : null),
    enabled: Boolean(selectedBrand),
    staleTime: 30 * 1000,
  });

  if (!selectedBrand) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>Select a brand to view image generation analytics</AlertDescription>
      </Alert>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="border-foreground h-8 w-8 animate-spin rounded-full border-b-2" />
      </div>
    );
  }

  if (query.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load analytics data. Please try again.</AlertDescription>
      </Alert>
    );
  }

  const data = query.data as ImageAnalyticsData | null;
  if (!data) {
    return null;
  }

  const hasData = data.overall.totalGenerated > 0;

  return (
    <div className="space-y-6">
      <ImageAnalyticsHeader brandName={selectedBrand.name} />

      {!hasData ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No image generations yet. Create posts with AI-generated images to see analytics here.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <ImageAnalyticsOverviewCards data={data} />
          <ProviderPerformanceCard data={data} />
          <RecentGenerationsCard data={data} />
          <CostOptimizationTips />
        </>
      )}
    </div>
  );
}
