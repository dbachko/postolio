import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Calendar, GripVertical, Loader2, RefreshCw, Unlink } from 'lucide-react';

import { formatSocialAccountHandle } from '@/lib/social-account-label';
import type { Platform } from '@/lib/platform-config';

import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import type { SortableAccountRowProps } from '../types';

export function SortableAccountRow({
  account,
  isPrimary,
  isSyncing,
  onSync,
  onQueueSettings,
  onDisconnect,
}: SortableAccountRowProps) {
  const title = account.displayName || account.username || account.externalAccountId;
  const subtitle =
    account.platform === 'instagram' && account.username
      ? formatSocialAccountHandle(account.platform, account.username)
      : null;
  const tokenBadge = (() => {
    const status = account.tokenStatus || (account.disconnected ? 'disconnected' : 'unknown');
    const { longLabel, shortLabel } = (() => {
      switch (status) {
        case 'healthy':
          return { longLabel: 'Token OK', shortLabel: 'OK' };
        case 'expiring':
          return { longLabel: 'Token expiring', shortLabel: 'Expiring' };
        case 'expired':
          return { longLabel: 'Token expired', shortLabel: 'Expired' };
        case 'disconnected':
          return { longLabel: 'Disconnected', shortLabel: 'Disconnected' };
        case 'unknown':
        default:
          return { longLabel: 'Token unknown', shortLabel: 'Unknown' };
      }
    })();

    const variant = (() => {
      switch (status) {
        case 'healthy':
          return 'success' as const;
        case 'expiring':
          return 'warning' as const;
        case 'expired':
          return 'destructive' as const;
        case 'disconnected':
          return 'secondary' as const;
        case 'unknown':
        default:
          return 'outline' as const;
      }
    })();

    const title = account.tokenExpiresAt ? `Expires at ${account.tokenExpiresAt}` : undefined;
    return (
      <Badge variant={variant} className="shrink-0" title={title}>
        <span className="sm:hidden">{shortLabel}</span>
        <span className="hidden sm:inline">{longLabel}</span>
      </Badge>
    );
  })();

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({
    id: account.id,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: account.id });
  const setRefs = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};

  return (
    <div
      ref={setRefs}
      style={style}
      className="bg-card flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
      data-dragging={isDragging ? 'true' : undefined}
      data-over={isOver ? 'true' : undefined}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Reorder social account"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </Button>
        <SocialAccountAvatar
          platform={account.platform as Platform}
          name={title}
          src={account.profilePictureUrl || null}
          size="md"
          muted={false}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-medium">{title}</div>
            {isPrimary && (
              <Badge variant="default" className="shrink-0">
                Primary
              </Badge>
            )}
            {tokenBadge}
          </div>
          {subtitle && <div className="text-muted-foreground truncate text-xs">{subtitle}</div>}
        </div>
      </div>
      <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
        <Button
          variant="outline"
          size="sm"
          onClick={onQueueSettings}
          aria-label="Publishing Schedule"
        >
          <Calendar className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Publishing Schedule</span>
        </Button>
        {onSync ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isSyncing}
            onClick={onSync}
            aria-label="Sync"
          >
            {isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">{isSyncing ? 'Syncing…' : 'Sync'}</span>
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onDisconnect} aria-label="Disconnect">
          <Unlink className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Disconnect</span>
        </Button>
      </div>
    </div>
  );
}
