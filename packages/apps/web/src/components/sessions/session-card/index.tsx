import { useState } from 'react';
import type { Session } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DeviceIcon } from '../device-icon';
import { MoreVertical, Edit2, LogOut, CheckCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { format, formatDistanceToNow } from 'date-fns';

interface SessionCardProps {
  session: Session;
  onRevoke: (sessionId: string) => Promise<void>;
  onEditDeviceName: (sessionId: string, currentName: string) => Promise<void>;
}

export function SessionCard({ session, onRevoke, onEditDeviceName }: SessionCardProps) {
  const [isRevoking, setIsRevoking] = useState(false);

  const handleRevoke = async () => {
    setIsRevoking(true);
    try {
      await onRevoke(session.id);
    } finally {
      setIsRevoking(false);
    }
  };

  const handleEditDeviceName = () => {
    onEditDeviceName(session.id, session.deviceName);
  };

  const getLocationString = () => {
    if (!session.location) {
      return null;
    }
    const parts = [];
    if (session.location.city) {
      parts.push(session.location.city);
    }
    if (session.location.country) {
      parts.push(session.location.country);
    }
    return parts.length > 0 ? parts.join(', ') : null;
  };

  const locationString = getLocationString();

  return (
    <Card className={session.isCurrent ? 'border-2' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex flex-1 items-center gap-3">
            <DeviceIcon
              userAgent={session.userAgent}
              deviceName={session.deviceName}
              className="text-muted-foreground h-6 w-6"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-base font-semibold">{session.deviceName}</h3>
                {session.isCurrent && (
                  <Badge variant="default">
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Current
                  </Badge>
                )}
                {session.trusted && <Badge variant="secondary">Trusted</Badge>}
              </div>
            </div>
          </div>

          {!session.isCurrent && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleEditDeviceName}>
                  <Edit2 className="mr-2 h-4 w-4" />
                  Edit name
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleRevoke}
                  disabled={isRevoking}
                  className="text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {isRevoking ? 'Revoking...' : 'Revoke session'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-4 text-sm">
          {locationString && (
            <div>
              <div className="text-muted-foreground">Location</div>
              <div className="font-medium">{locationString}</div>
            </div>
          )}
          {session.ipAddress && (
            <div>
              <div className="text-muted-foreground">IP Address</div>
              <div className="font-mono text-xs font-medium">{session.ipAddress}</div>
            </div>
          )}
          <div>
            <div className="text-muted-foreground">Last active</div>
            <div className="font-medium">
              {formatDistanceToNow(new Date(session.lastActivityAt), { addSuffix: true })}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Logged in</div>
            <div className="font-medium">{format(new Date(session.createdAt), 'PPp')}</div>
          </div>
        </div>

        {session.userAgent && (
          <div className="border-t pt-2">
            <div className="text-muted-foreground text-xs">User Agent</div>
            <div className="text-muted-foreground truncate text-xs" title={session.userAgent}>
              {session.userAgent}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
