import { format } from 'date-fns';
import { BarChart3, Clock, DollarSign, Image as ImageIcon, Info, TrendingUp } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { getLogStatusBadgeVariant, PROVIDER_DISPLAY_NAMES } from './constants';
import type { ImageAnalyticsData } from './types';

export function ImageAnalyticsHeader(props: { brandName: string }) {
  return (
    <div>
      <h2 className="mb-2 text-xl font-semibold">Image Generation Analytics</h2>
      <p className="text-muted-foreground text-sm">
        Track AI image generation costs and usage for{' '}
        <span className="font-medium">{props.brandName}</span>
      </p>
    </div>
  );
}

export function ImageAnalyticsOverviewCards(props: { data: ImageAnalyticsData }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <ImageIcon className="h-4 w-4" /> Total Generated
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{props.data.overall.totalGenerated}</p>
          <p className="text-muted-foreground mt-1 text-xs">images created</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <DollarSign className="h-4 w-4" /> Total Cost
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">${props.data.overall.totalCost.toFixed(2)}</p>
          <p className="text-muted-foreground mt-1 text-xs">across all providers</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <TrendingUp className="h-4 w-4" /> Average Cost
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">${props.data.overall.avgCostPerImage.toFixed(3)}</p>
          <p className="text-muted-foreground mt-1 text-xs">per image</p>
        </CardContent>
      </Card>
    </div>
  );
}

export function ProviderPerformanceCard(props: { data: ImageAnalyticsData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" /> Provider Performance
        </CardTitle>
        <CardDescription>Cost and performance comparison across AI image providers</CardDescription>
      </CardHeader>
      <CardContent>
        {Object.keys(props.data.byProvider).length > 0 ? (
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
              {Object.entries(props.data.byProvider)
                .sort(([, a], [, b]) => b.count - a.count)
                .map(([provider, stats]) => (
                  <TableRow key={provider}>
                    <TableCell className="font-medium">
                      {PROVIDER_DISPLAY_NAMES[provider] || provider}
                    </TableCell>
                    <TableCell className="text-right">{stats.count}</TableCell>
                    <TableCell className="text-right">${stats.totalCost.toFixed(2)}</TableCell>
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
  );
}

export function RecentGenerationsCard(props: { data: ImageAnalyticsData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" /> Recent Generations
        </CardTitle>
        <CardDescription>Last 10 image generation requests</CardDescription>
      </CardHeader>
      <CardContent>
        {props.data.recentLogs.length > 0 ? (
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
              {props.data.recentLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-medium">
                    {PROVIDER_DISPLAY_NAMES[log.provider] || log.provider}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getLogStatusBadgeVariant(log.status)} className="text-xs">
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
  );
}

export function CostOptimizationTips() {
  return (
    <Alert>
      <Info className="h-4 w-4" />
      <AlertDescription>
        <div className="font-semibold">Cost Optimization Tips</div>
        <ul className="mt-2 space-y-1 text-sm">
          <li>• Gemini 2.5 Flash offers the best value at $0.039/image with fast generation</li>
          <li>• Set your preferred provider in Brand Settings to control costs</li>
          <li>• Monitor generation logs to identify which posts consume the most resources</li>
        </ul>
      </AlertDescription>
    </Alert>
  );
}
