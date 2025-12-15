import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BarChart3, DollarSign, Image as ImageIcon, Clock, Info, TrendingUp } from 'lucide-react';
import { brand as brandApi } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';
import { format } from 'date-fns';

export default function ImageAnalytics() {
  const { selectedBrand } = useBrandStore();
  const [dateRange] = useState<{ startDate?: string; endDate?: string }>({});

  // Fetch analytics data
  const { data, isLoading, error } = useQuery({
    queryKey: ['imageAnalytics', selectedBrand?.id, dateRange],
    queryFn: () => {
      if (!selectedBrand) return null;
      return brandApi.getImageAnalytics(selectedBrand.id, dateRange);
    },
    enabled: !!selectedBrand,
    staleTime: 30 * 1000, // Cache for 30 seconds
  });

  if (!selectedBrand) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>Select a brand to view image generation analytics</AlertDescription>
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="border-foreground h-8 w-8 animate-spin rounded-full border-b-2"></div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load analytics data. Please try again.</AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return null;
  }

  const { overall, byProvider, recentLogs } = data;
  const hasData = overall.totalGenerated > 0;

  // Get provider display names
  const providerDisplayNames: Record<string, string> = {
    'dalle-3': 'DALL-E 3',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-3-pro': 'Gemini 3 Pro',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="mb-2 text-xl font-semibold">Image Generation Analytics</h2>
        <p className="text-muted-foreground text-sm">
          Track AI image generation costs and usage for{' '}
          <span className="font-medium">{selectedBrand.name}</span>
        </p>
      </div>

      {!hasData && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No image generations yet. Create a campaign with AI-generated images to see analytics
            here.
          </AlertDescription>
        </Alert>
      )}

      {hasData && (
        <>
          {/* Overview Cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <ImageIcon className="h-4 w-4" />
                  Total Generated
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{overall.totalGenerated}</p>
                <p className="text-muted-foreground mt-1 text-xs">images created</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <DollarSign className="h-4 w-4" />
                  Total Cost
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">${overall.totalCost.toFixed(2)}</p>
                <p className="text-muted-foreground mt-1 text-xs">across all providers</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <TrendingUp className="h-4 w-4" />
                  Average Cost
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">${overall.avgCostPerImage.toFixed(3)}</p>
                <p className="text-muted-foreground mt-1 text-xs">per image</p>
              </CardContent>
            </Card>
          </div>

          {/* Provider Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Provider Performance
              </CardTitle>
              <CardDescription>
                Cost and performance comparison across AI image providers
              </CardDescription>
            </CardHeader>
            <CardContent>
              {Object.keys(byProvider).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead className="text-right">Images</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead className="text-right">Avg Cost</TableHead>
                      <TableHead className="text-right">Avg Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(byProvider)
                      .sort(([, a], [, b]) => b.count - a.count)
                      .map(([provider, stats]) => (
                        <TableRow key={provider}>
                          <TableCell className="font-medium">
                            {providerDisplayNames[provider] || provider}
                          </TableCell>
                          <TableCell className="text-right">{stats.count}</TableCell>
                          <TableCell className="text-right">
                            ${stats.totalCost.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">${stats.avgCost.toFixed(3)}</TableCell>
                          <TableCell className="text-right">
                            {(stats.avgTime / 1000).toFixed(1)}s
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-sm">No provider data available</p>
              )}
            </CardContent>
          </Card>

          {/* Recent Generation Logs */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Recent Generations
              </CardTitle>
              <CardDescription>Last 10 image generation requests</CardDescription>
            </CardHeader>
            <CardContent>
              {recentLogs.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Time</TableHead>
                      <TableHead className="text-right">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium">
                          {providerDisplayNames[log.provider] || log.provider}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              log.status === 'success'
                                ? 'default'
                                : log.status === 'fallback'
                                  ? 'secondary'
                                  : 'destructive'
                            }
                            className="text-xs"
                          >
                            {log.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">${log.cost.toFixed(3)}</TableCell>
                        <TableCell className="text-right">
                          {(log.generationTime / 1000).toFixed(1)}s
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right text-xs">
                          {format(new Date(log.createdAt), 'MMM d, h:mm a')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-sm">No recent generations</p>
              )}
            </CardContent>
          </Card>

          {/* Cost Insights */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <div className="font-semibold">Cost Optimization Tips</div>
              <ul className="mt-2 space-y-1 text-sm">
                <li>
                  • Gemini 2.5 Flash offers the best value at $0.039/image with fast generation
                </li>
                <li>• Set your preferred provider in Brand Settings to control costs</li>
                <li>
                  • Monitor generation logs to identify which campaigns consume the most resources
                </li>
              </ul>
            </AlertDescription>
          </Alert>
        </>
      )}
    </div>
  );
}
