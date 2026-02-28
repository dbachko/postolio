import type { LoginHistoryItem } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DeviceIcon } from '@/components/sessions/device-icon';
import { format } from 'date-fns';
import { CheckCircle, XCircle } from 'lucide-react';

interface LoginHistoryProps {
  history: LoginHistoryItem[];
}

const REVOKED_REASON_MAP: Record<string, string> = {
  user_requested: 'Logged out by user',
  expired: 'Session expired',
  sliding_timeout: 'Inactivity timeout',
  absolute_timeout: 'Maximum session duration reached',
  admin_revoked: 'Revoked by administrator',
};

function getLocationString(location?: { city?: string; country?: string } | null) {
  if (!location) {
    return null;
  }
  const parts = [location.city, location.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

function getStatusBadge(item: LoginHistoryItem) {
  if (item.status === 'active') {
    return (
      <Badge variant="default">
        <CheckCircle className="mr-1 h-3 w-3" />
        Active
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <XCircle className="mr-1 h-3 w-3" />
      Revoked
    </Badge>
  );
}

function getRevokedReasonText(reason?: string | null) {
  if (!reason) {
    return null;
  }
  return REVOKED_REASON_MAP[reason] || reason;
}

export function LoginHistory({ history }: LoginHistoryProps) {
  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Login Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground py-8 text-center">No login history available.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Login Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {history.map((item, index) => {
            const locationString = getLocationString(item.location);

            return (
              <div
                key={index}
                className="flex items-start gap-4 border-b pb-4 last:border-0 last:pb-0"
              >
                <DeviceIcon
                  deviceName={item.device}
                  className="text-muted-foreground mt-1 h-5 w-5"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.device}</span>
                    {getStatusBadge(item)}
                  </div>

                  <div className="mt-1 space-y-1">
                    <div className="text-muted-foreground text-sm">
                      {format(new Date(item.timestamp), 'PPp')}
                    </div>

                    {locationString && (
                      <div className="text-muted-foreground text-sm">{locationString}</div>
                    )}

                    {item.ipAddress && (
                      <div className="text-muted-foreground font-mono text-xs">
                        {item.ipAddress}
                      </div>
                    )}

                    {item.status === 'revoked' && item.revokedReason && (
                      <div className="text-muted-foreground text-xs italic">
                        {getRevokedReasonText(item.revokedReason)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
