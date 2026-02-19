import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ScheduleSetupReminderCard() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="text-muted-foreground h-4 w-4" aria-hidden="true" />
            Set up your publishing schedule
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            No queue slots are configured yet. Add weekly slots so posts can flow automatically.
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/social-accounts/publishing-schedule">Set up schedule</Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-muted-foreground text-xs">
          You can create multiple queues and choose which one is default per account.
        </p>
      </CardContent>
    </Card>
  );
}
