import type { LoginHistoryItem } from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { DeviceIcon } from '../sessions/DeviceIcon';
import { format } from 'date-fns';
import { CheckCircle, XCircle } from 'lucide-react';

interface LoginHistoryProps {
  history: LoginHistoryItem[];
}

export function LoginHistory({ history }: LoginHistoryProps) {
  const getLocationString = (location?: { city?: string; country?: string } | null) => {
    if (!location) return null;
    const parts = [];
    if (location.city) parts.push(location.city);
    if (location.country) parts.push(location.country);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  const getStatusBadge = (item: LoginHistoryItem) => {
    if (item.status === 'active') {
      return (
        <Badge variant="default" className="bg-green-100 text-green-800">
          <CheckCircle className="mr-1 h-3 w-3" />
          Active
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="text-gray-600">
        <XCircle className="mr-1 h-3 w-3" />
        Revoked
      </Badge>
    );
  };

  const getRevokedReasonText = (reason?: string | null) => {
    if (!reason) return null;

    const reasonMap: Record<string, string> = {
      user_requested: 'Logged out by user',
      expired: 'Session expired',
      sliding_timeout: 'Inactivity timeout',
      absolute_timeout: 'Maximum session duration reached',
      admin_revoked: 'Revoked by administrator',
    };

    return reasonMap[reason] || reason;
  };

  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Login Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-gray-500">No login history available.</p>
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
                <DeviceIcon deviceName={item.device} className="mt-1 h-5 w-5 text-gray-500" />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.device}</span>
                    {getStatusBadge(item)}
                  </div>

                  <div className="mt-1 space-y-1">
                    <div className="text-sm text-gray-600">
                      {format(new Date(item.timestamp), 'PPp')}
                    </div>

                    {locationString && (
                      <div className="text-sm text-gray-500">{locationString}</div>
                    )}

                    {item.ipAddress && (
                      <div className="font-mono text-xs text-gray-400">{item.ipAddress}</div>
                    )}

                    {item.status === 'revoked' && item.revokedReason && (
                      <div className="text-xs italic text-gray-500">
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
