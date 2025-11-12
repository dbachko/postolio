import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Hash } from 'lucide-react';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { formatNumber } from '@/utils/formatNumber';

interface Hashtag {
  tag: string;
  avgEngagement: number;
  count: number;
}

interface PerformanceByDate {
  date: string;
  impressions: number;
  engagement: number;
}

interface PerformanceTabProps {
  topHashtags: Hashtag[];
  performanceByDate: PerformanceByDate[];
  timezone?: string;
}

export function PerformanceTab({ topHashtags, performanceByDate, timezone }: PerformanceTabProps) {
  return (
    <div className="space-y-6">
      {/* Top Hashtags */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5" />
            Top Performing Hashtags
          </CardTitle>
          <CardDescription>Best hashtags by average engagement</CardDescription>
        </CardHeader>
        <CardContent>
          {topHashtags.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center">No hashtag data available yet</p>
          ) : (
            <div className="space-y-3">
              {topHashtags.slice(0, 10).map((hashtag, index) => (
                <div key={hashtag.tag} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">#{index + 1}</Badge>
                    <span className="font-medium">#{hashtag.tag}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{formatNumber(hashtag.avgEngagement)}</div>
                    <div className="text-muted-foreground text-xs">
                      Used {hashtag.count} time
                      {hashtag.count !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Performance Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Timeline</CardTitle>
          <CardDescription>Daily performance breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          {performanceByDate.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center">
              No performance timeline data available yet
            </p>
          ) : (
            <div className="space-y-3">
              {performanceByDate.slice(-7).map((day) => (
                <div key={day.date} className="flex items-center justify-between">
                  <span className="text-sm">
                    {timezone
                      ? formatInTimeZone(new Date(day.date), timezone, 'MMM d, yyyy')
                      : format(new Date(day.date), 'MMM d, yyyy')}
                  </span>
                  <div className="flex gap-4 text-sm">
                    <span>{formatNumber(day.impressions)} impressions</span>
                    <span>{formatNumber(day.engagement)} engagement</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
