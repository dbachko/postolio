import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SchedulePhase } from '../types';

interface PostingScheduleCardProps {
  schedulePhases: SchedulePhase[];
}

export function PostingScheduleCard({ schedulePhases }: PostingScheduleCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Posting Schedule</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-2 text-sm">
        {schedulePhases.length === 0 ? (
          <>
            <div className="bg-muted h-4 w-4/5 animate-pulse rounded" />
            <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
          </>
        ) : (
          <div className="space-y-2">
            {schedulePhases.map((ph, idx) => (
              <div key={idx} className="rounded border p-2">
                <div className="font-medium">{ph.phase}</div>
                <div className="text-muted-foreground text-xs">
                  Starts day +{ph.startOffsetDays} • {ph.frequency}
                </div>
                <div className="text-muted-foreground text-xs">{ph.rationale}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
