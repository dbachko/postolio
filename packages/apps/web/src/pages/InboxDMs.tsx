import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock } from 'lucide-react';

export default function InboxDMs() {
  // Temporary: DMs are not yet supported. Show coming-soon screen unconditionally.
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Direct Messages</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="border-border bg-muted/10 text-muted-foreground flex flex-col items-center justify-center rounded-md border p-10 text-center">
          <Clock className="mb-3 h-10 w-10 opacity-70" />
          <div className="text-foreground mb-1 text-base font-semibold">
            Direct Messages are coming soon
          </div>
          <div className="text-muted-foreground max-w-md text-sm">
            We’re finishing support for Instagram DMs. Check back later or follow updates in the
            Changelog.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
