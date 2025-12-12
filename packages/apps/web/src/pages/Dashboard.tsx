import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { brand as brandApi, campaign as campaignApi, content as contentApi } from '../lib/api';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBrandStore } from '../stores/brandStore';
import { CampaignProgress } from '@/components/CampaignProgress';
import { Sparkles } from 'lucide-react';

export function Dashboard() {
  const { brands, setBrands, initializeSelectedBrand } = useBrandStore();

  // WebSocket connection active in background for real-time updates

  const { data: brandsData, isLoading: brandsLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: () => brandApi.getBrands(),
  });

  useEffect(() => {
    if (brandsData?.brands) {
      setBrands(brandsData.brands);
      initializeSelectedBrand(brandsData.brands);
    }
  }, [brandsData, setBrands, initializeSelectedBrand]);

  // Get comprehensive metrics across all brands
  const { data: allCampaignsData } = useQuery({
    queryKey: ['allCampaigns'],
    queryFn: () => campaignApi.listCampaigns(), // Get campaigns for all brands
    enabled: brands.length > 0,
  });

  // Get content metrics from all user's brands
  const { data: contentMetricsData } = useQuery({
    queryKey: ['contentMetrics', brands.map((b) => b.id)],
    queryFn: async () => {
      if (brands.length === 0) return { scheduled: 0, published: 0 };

      // Get content from all brands
      const promises = brands.map((b) => contentApi.getContentHistory(b.id));
      const results = await Promise.all(promises);

      const allContent = results.flatMap((result) => result?.content || []);

      return {
        scheduled: allContent.filter(
          (content) =>
            content.status === 'scheduled' &&
            content.scheduledAt &&
            new Date(content.scheduledAt) > new Date()
        ).length,
        published: allContent.filter((content) => content.status === 'published').length,
      };
    },
    enabled: brands.length > 0,
  });

  const allCampaigns = ((allCampaignsData as any)?.campaigns || []) as any[] as any[];
  const contentMetrics = contentMetricsData || { scheduled: 0, published: 0 };

  // Calculate campaign-focused metrics
  const activeCampaigns = allCampaigns.filter((campaign) => campaign.status === 'active').length;
  const scheduledPosts = contentMetrics.scheduled;
  const publishedPosts = contentMetrics.published;

  if (brandsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="border-foreground h-8 w-8 animate-spin rounded-full border-b-2"></div>
      </div>
    );
  }

  if (brands.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-16 text-center">
        <div className="bg-muted text-muted-foreground flex h-12 w-12 items-center justify-center rounded-full">
          <Sparkles className="h-5 w-5 shrink-0" />
        </div>
        <div className="space-y-2">
          <h2 className="text-foreground text-xl font-semibold">Welcome to Postolio</h2>
          <p className="text-muted-foreground text-sm">
            Create your first brand to start campaigns, plan content, and track performance.
          </p>
        </div>
        <Button size="lg" asChild>
          <Link to="/brands">Create Your First Brand</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {allCampaigns.length > 0 && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Active Campaigns ({allCampaigns.length})</h2>
            <Button variant="link" asChild className="text-primary text-sm hover:underline">
              <Link to="/campaigns">View All →</Link>
            </Button>
          </div>
          <CampaignProgress allBrands={true} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Total Brands</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-primary text-3xl font-bold">{brands.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Active Campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground text-3xl font-bold">{activeCampaigns}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Scheduled Posts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground text-3xl font-bold">{scheduledPosts}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Published Posts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground text-3xl font-bold">{publishedPosts}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
