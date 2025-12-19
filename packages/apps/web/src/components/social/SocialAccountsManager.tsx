import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Brand } from '@/lib/api';
import { brand as brandApi } from '@/lib/api';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ProfileAvatar } from '@/components/ui/profile-avatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { GripVertical, Link2, Loader2, Plus } from 'lucide-react';
import { FacebookIcon, InstagramIcon } from '@/components/icons/BrandIcons';
import { SocialAccountsPicker } from '@/components/social/SocialAccountsPicker';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type ConnectedAccount = {
  id: string;
  platform: string;
  externalAccountId: string;
  externalPageId?: string | null;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  disconnected: boolean;
  tokenStatus?: 'healthy' | 'expiring' | 'expired' | 'unknown' | 'disconnected';
  tokenExpiresAt?: string | null;
  metadata?: any;
  sortOrder: number;
  createdAt: string;
};

type MetaCandidate = {
  candidateId: string;
  platform: 'instagram' | 'facebook';
  externalAccountId: string;
  externalPageId?: string | null;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  metadata?: Record<string, unknown>;
};

interface SocialAccountsManagerProps {
  brand: Brand;
  onAccountsChanged?: () => void;
}

type ConnectIntent = 'instagram' | 'facebook';

function allowedMessageOrigins(): string[] {
  const allowed = [window.location.origin];
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) {
    try {
      const apiOrigin = new URL(apiUrl).origin;
      if (apiOrigin !== window.location.origin) allowed.push(apiOrigin);
    } catch (_e) {
      // ignore
    }
  }
  return allowed;
}

function SortableAccountRow({
  account,
  isPrimary,
  isSyncing,
  onSync,
  onDisconnect,
}: {
  account: ConnectedAccount;
  isPrimary: boolean;
  isSyncing: boolean;
  onSync: (() => void) | null;
  onDisconnect: () => void;
}) {
  const config = (() => {
    try {
      return getPlatformConfig(account.platform as any);
    } catch {
      return null;
    }
  })();

  const title = account.displayName || account.username || account.externalAccountId;
  const subtitle =
    account.platform === 'instagram' && account.username ? `@${account.username}` : null;
  const tokenBadge = (() => {
    const status = account.tokenStatus || (account.disconnected ? 'disconnected' : 'unknown');
    const label = (() => {
      switch (status) {
        case 'healthy':
          return 'Token OK';
        case 'expiring':
          return 'Token expiring';
        case 'expired':
          return 'Token expired';
        case 'disconnected':
          return 'Disconnected';
        case 'unknown':
        default:
          return 'Token unknown';
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
        {label}
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
      className="bg-card flex items-center justify-between gap-3 rounded-lg border p-3"
      data-dragging={isDragging ? 'true' : undefined}
      data-over={isOver ? 'true' : undefined}
    >
      <div className="flex min-w-0 items-center gap-3">
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
        <ProfileAvatar src={account.profilePictureUrl || null} name={title} alt={title} size="md" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-medium">{title}</div>
            <Badge variant="secondary" className="shrink-0">
              {config?.displayName || account.platform}
            </Badge>
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
      <div className="flex shrink-0 items-center gap-2">
        {onSync ? (
          <Button variant="outline" disabled={isSyncing} onClick={onSync}>
            {isSyncing ? 'Syncing…' : 'Sync'}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}

export function SocialAccountsManager({ brand, onAccountsChanged }: SocialAccountsManagerProps) {
  const queryClient = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectIntent, setConnectIntent] = useState<ConnectIntent>('instagram');
  const [connectingIntent, setConnectingIntent] = useState<ConnectIntent | null>(null);
  const [connectSessionId, setConnectSessionId] = useState<string | null>(null);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [connectError, setConnectError] = useState<string | null>(null);
  const connectDialogOpenedRef = useRef(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectedAccount | null>(null);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [orderedConnectedIds, setOrderedConnectedIds] = useState<string[]>([]);

  const accountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brand.id],
    queryFn: () => brandApi.getConnectedAccounts(brand.id),
    staleTime: CACHE_TIMES.LONG,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });

  const socialAccounts: ConnectedAccount[] = useMemo(() => {
    const data = accountsQuery.data as any;
    return Array.isArray(data?.socialAccounts) ? (data.socialAccounts as ConnectedAccount[]) : [];
  }, [accountsQuery.data]);

  const connectedAccounts = useMemo(
    () =>
      socialAccounts
        .filter((a) => !a.disconnected)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)),
    [socialAccounts]
  );

  useEffect(() => {
    setOrderedConnectedIds(connectedAccounts.map((a) => a.id));
  }, [connectedAccounts]);

  const primarySocialAccountId = useMemo(() => {
    const data = accountsQuery.data as any;
    const raw = data?.primarySocialAccountId;
    return typeof raw === 'string' && raw.trim() ? raw : (orderedConnectedIds[0] ?? null);
  }, [accountsQuery.data, orderedConnectedIds]);

  const defaultPostSocialAccountIds = useMemo(() => {
    const data = accountsQuery.data as any;
    const raw = data?.defaultPostSocialAccountIds;
    if (!Array.isArray(raw)) return [] as string[];

    const allowed = new Set(connectedAccounts.map((account) => account.id));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of raw) {
      if (typeof v !== 'string') continue;
      const id = v.trim();
      if (!id || !allowed.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [accountsQuery.data, connectedAccounts]);

  const defaultPostSocialAccountOptions = useMemo(() => {
    return connectedAccounts
      .map((account) => {
        const platform = account.platform as Platform;
        const platformConfig = getPlatformConfig(platform);
        const shortLabel = account.username ? `@${account.username}` : account.displayName || '';
        const avatarName =
          account.displayName ||
          account.username ||
          account.externalAccountId ||
          platformConfig.displayName;
        const tooltipLabel = shortLabel
          ? `${platformConfig.displayName} · ${shortLabel}`
          : platformConfig.displayName;

        return {
          id: account.id,
          platform,
          label: shortLabel,
          tooltipLabel,
          avatarName,
          avatarUrl: account.profilePictureUrl || null,
          disabled: false,
        };
      })
      .sort((a, b) => a.platform.localeCompare(b.platform) || a.id.localeCompare(b.id));
  }, [connectedAccounts]);

  const defaultAccountsMutation = useMutation({
    mutationFn: async (socialAccountIds: string[]) => {
      return brandApi.setDefaultPostSocialAccounts(brand.id, socialAccountIds);
    },
    onMutate: async (socialAccountIds) => {
      await queryClient.cancelQueries({ queryKey: ['brand-social-accounts', brand.id] });
      const previous = queryClient.getQueryData(['brand-social-accounts', brand.id]);
      queryClient.setQueryData(['brand-social-accounts', brand.id], (old: any) => {
        if (!old || typeof old !== 'object') return old;
        return { ...old, defaultPostSocialAccountIds: socialAccountIds };
      });
      return { previous };
    },
    onSuccess: () => {
      toast.success('Default accounts updated');
    },
    onError: (error: any, _ids, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['brand-social-accounts', brand.id], ctx.previous);
      }
      toast.error('Failed to update defaults', {
        description: error?.message || 'Please try again',
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['brand-social-accounts', brand.id] });
      onAccountsChanged?.();
    },
  });

  const startConnectMutation = useMutation({
    mutationFn: (_intent: ConnectIntent) => brandApi.startMetaConnect(brand.id),
    onMutate: (intent) => {
      setConnectError(null);
      setConnectIntent(intent);
      setConnectingIntent(intent);
      setConnectSessionId(null);
      connectDialogOpenedRef.current = false;
    },
    onSuccess: (data) => {
      const initialConnectSessionId =
        typeof data.connectSessionId === 'string' && data.connectSessionId.trim()
          ? data.connectSessionId
          : null;
      if (initialConnectSessionId) setConnectSessionId(initialConnectSessionId);

      const popup = window.open(
        data.authUrl,
        'meta-oauth',
        'width=600,height=750,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        setConnectError('Pop-up blocked. Please allow pop-ups and try again.');
        setIsConnecting(false);
        setConnectingIntent(null);
        return;
      }

      const handleMessage = (event: MessageEvent) => {
        if (!allowedMessageOrigins().includes(event.origin)) return;
        if (!event.data || typeof event.data.type !== 'string') return;

        if (event.data.type === 'META_OAUTH_SUCCESS') {
          const id = event.data?.data?.connectSessionId;
          if (typeof id === 'string' && id.trim()) {
            setConnectSessionId(id);
            setConnectDialogOpen(true);
            connectDialogOpenedRef.current = true;
          }
          setIsConnecting(false);
          setConnectingIntent(null);
          window.removeEventListener('message', handleMessage);
        }

        if (event.data.type === 'META_OAUTH_ERROR') {
          setConnectError(event.data?.data?.errorDescription || 'Meta connect failed');
          setIsConnecting(false);
          setConnectingIntent(null);
          window.removeEventListener('message', handleMessage);
        }
      };

      window.addEventListener('message', handleMessage);

      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          setIsConnecting(false);
          setConnectingIntent(null);
          window.removeEventListener('message', handleMessage);

          if (connectDialogOpenedRef.current) return;
          if (initialConnectSessionId) {
            setConnectSessionId(initialConnectSessionId);
            setConnectDialogOpen(true);
            connectDialogOpenedRef.current = true;
          }
        }
      }, 1000);

      setIsConnecting(true);
    },
    onError: (error: any) => {
      setConnectError(error?.message || 'Failed to start Meta connect');
      setIsConnecting(false);
      setConnectingIntent(null);
    },
  });

  const candidatesQuery = useQuery({
    queryKey: ['meta-connect-candidates', connectSessionId],
    queryFn: () => brandApi.getMetaConnectCandidates(connectSessionId!),
    enabled: !!connectSessionId,
    refetchInterval: (query) => {
      if (!connectDialogOpen) return false;
      if (!connectSessionId) return false;
      const data = query.state.data as any;
      const candidates = data?.candidates;
      if (Array.isArray(candidates) && candidates.length > 0) return false;
      const error = query.state.error as any;
      const status = error?.status;
      const code = error?.data?.error;
      if (
        status === 404 &&
        (code === 'connect_candidates_not_found' || code === 'connect_session_not_found')
      ) {
        return 1000;
      }
      return false;
    },
    refetchOnWindowFocus: false,
  });

  const candidates: MetaCandidate[] = useMemo(() => {
    const data = candidatesQuery.data as any;
    return Array.isArray(data?.candidates) ? (data.candidates as MetaCandidate[]) : [];
  }, [candidatesQuery.data]);

  const candidatesError = candidatesQuery.error as any;
  const isWaitingForCandidates =
    candidatesQuery.isError &&
    candidatesError?.status === 404 &&
    (candidatesError?.data?.error === 'connect_candidates_not_found' ||
      candidatesError?.data?.error === 'connect_session_not_found');

  const groupedCandidates = useMemo(() => {
    return {
      instagram: candidates.filter((c) => c.platform === 'instagram'),
      facebook: candidates.filter((c) => c.platform === 'facebook'),
    };
  }, [candidates]);

  useEffect(() => {
    if (!connectDialogOpen) return;
    if (!candidates.length) return;
    if (selectedCandidateIds.size > 0) return;

    const defaults = new Set<string>();
    for (const c of candidates) {
      if (connectIntent === 'instagram' && c.platform === 'instagram') defaults.add(c.candidateId);
      if (connectIntent === 'facebook' && c.platform === 'facebook') defaults.add(c.candidateId);
    }
    setSelectedCandidateIds(defaults);
  }, [connectDialogOpen, candidates, selectedCandidateIds.size, connectIntent]);

  const finalizeConnectMutation = useMutation({
    mutationFn: async () => {
      if (!connectSessionId) throw new Error('Missing connectSessionId');
      return brandApi.finalizeMetaConnect(connectSessionId, Array.from(selectedCandidateIds));
    },
    onSuccess: async () => {
      setConnectDialogOpen(false);
      setConnectSessionId(null);
      setSelectedCandidateIds(new Set());
      await queryClient.invalidateQueries({ queryKey: ['brand-social-accounts', brand.id] });
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
      onAccountsChanged?.();
    },
    onError: (error: any) => {
      setConnectError(error?.message || 'Failed to finalize Meta connect');
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (opts: { socialAccountId: string; removeImportedPosts: boolean }) => {
      return brandApi.disconnectSocialAccount(brand.id, opts.socialAccountId, {
        removeImportedPosts: opts.removeImportedPosts,
      });
    },
    onSuccess: async () => {
      setDisconnectDialogOpen(false);
      setDisconnectTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['brand-social-accounts', brand.id] });
      onAccountsChanged?.();
    },
  });

  const syncPostsMutation = useMutation({
    mutationFn: async (account: ConnectedAccount) => {
      return brandApi.syncSocialPosts(brand.id, account.platform, {
        maxPosts: 100,
        maxDays: 30,
        socialAccountId: account.id,
      });
    },
    onMutate: (account) => {
      setSyncingAccountId(account.id);
    },
    onSuccess: async (data: any) => {
      const synced = Number(data?.results?.synced || 0);
      const skipped = Number(data?.results?.skipped || 0);
      const failed = Number(data?.results?.failed || 0);

      if (synced > 0) {
        toast.success(`Synced ${synced} posts`, {
          description:
            skipped > 0 || failed > 0
              ? `${skipped > 0 ? `${skipped} skipped` : ''}${skipped > 0 && failed > 0 ? ', ' : ''}${failed > 0 ? `${failed} failed` : ''}`
              : undefined,
        });
      } else if (skipped > 0) {
        toast.info('No new posts to sync', { description: `${skipped} already imported` });
      } else {
        toast.info('No posts found to sync');
      }

      setSyncingAccountId(null);
      await queryClient.invalidateQueries({ queryKey: ['calendar', brand.id] });
      await queryClient.invalidateQueries({ queryKey: ['content', brand.id] });
      onAccountsChanged?.();
    },
    onError: (error: any) => {
      setSyncingAccountId(null);
      toast.error('Sync failed', { description: error?.message || 'Please try again' });
    },
  });

  const reorderAccountsMutation = useMutation({
    mutationFn: async (orderedIds: string[]) =>
      brandApi.setSocialAccountOrder(brand.id, orderedIds),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: ['brand-social-accounts', brand.id] });
      const previous = queryClient.getQueryData(['brand-social-accounts', brand.id]);
      queryClient.setQueryData(['brand-social-accounts', brand.id], (old: any) => {
        if (!old || typeof old !== 'object') return old;
        const accounts = Array.isArray(old.socialAccounts) ? old.socialAccounts.slice() : [];
        const orderIndex = new Map(orderedIds.map((id, idx) => [id, idx]));
        const nextAccounts = accounts.map((a: any) => {
          const idx = orderIndex.get(a?.id);
          if (typeof idx !== 'number') return a;
          return { ...a, sortOrder: idx };
        });
        return {
          ...old,
          socialAccounts: nextAccounts,
          primarySocialAccountId: orderedIds[0] || null,
        };
      });
      return { previous };
    },
    onError: (error: any, _orderedIds, ctx) => {
      if (ctx?.previous)
        queryClient.setQueryData(['brand-social-accounts', brand.id], ctx.previous);
      toast.error('Failed to reorder accounts', {
        description: error?.message || 'Please try again',
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['brand-social-accounts', brand.id] });
      onAccountsChanged?.();
    },
  });

  const toggleCandidate = (candidateId: string, checked: boolean) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(candidateId);
      else next.delete(candidateId);
      return next;
    });
  };

  const handleDisconnect = (account: ConnectedAccount) => {
    setDisconnectTarget(account);
    setDisconnectDialogOpen(true);
  };

  const orderedAccounts = useMemo(() => {
    const byId = new Map(connectedAccounts.map((a) => [a.id, a]));
    return orderedConnectedIds.map((id) => byId.get(id)).filter(Boolean) as ConnectedAccount[];
  }, [connectedAccounts, orderedConnectedIds]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function moveId(list: string[], activeId: string, overId: string): string[] {
    const from = list.indexOf(activeId);
    const to = list.indexOf(overId);
    if (from === -1 || to === -1 || from === to) return list;
    const next = list.slice();
    const [removed] = next.splice(from, 1);
    next.splice(to, 0, removed);
    return next;
  }

  const instagramPlatform = getPlatformConfig('instagram');
  const facebookPlatform = getPlatformConfig('facebook');
  const connectActionLabel = connectedAccounts.length > 0 ? 'Add' : 'Connect';

  const connectButtons = (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        <div className="text-muted-foreground flex items-center gap-1 text-xs font-medium">
          {connectActionLabel === 'Add' ? (
            <Plus className="h-3.5 w-3.5" />
          ) : (
            <Link2 className="h-3.5 w-3.5" />
          )}
          {connectActionLabel}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              aria-label="Connect Instagram accounts"
              onClick={() => startConnectMutation.mutate('instagram')}
              disabled={startConnectMutation.isPending || isConnecting}
              className="hover:opacity-90"
              style={{
                backgroundColor: instagramPlatform.color,
                backgroundImage:
                  'linear-gradient(45deg, #feda75 0%, #fa7e1e 25%, #d62976 50%, #962fbf 75%, #4f5bd5 100%)',
                borderColor: instagramPlatform.color,
                color: 'white',
              }}
            >
              {connectingIntent === 'instagram' && isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <InstagramIcon className="h-4 w-4" aria-hidden="true" />
              )}
              <span>Instagram</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Connect Instagram (Business/Creator)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              aria-label="Connect Facebook Pages"
              onClick={() => startConnectMutation.mutate('facebook')}
              disabled={startConnectMutation.isPending || isConnecting}
              className="hover:opacity-90"
              style={{
                backgroundColor: facebookPlatform.color,
                borderColor: facebookPlatform.color,
                color: 'white',
              }}
            >
              {connectingIntent === 'facebook' && isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FacebookIcon className="h-4 w-4" aria-hidden="true" />
              )}
              <span>Facebook</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Connect Facebook (Pages)</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Social accounts</CardTitle>
        <CardDescription>
          Connect Instagram Business/Creator accounts and Facebook Pages to {brand.name}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {accountsQuery.isLoading && <div className="bg-muted h-20 animate-pulse rounded" />}

        {!accountsQuery.isLoading && connectError && (
          <Alert variant="destructive">
            <AlertDescription>{connectError}</AlertDescription>
          </Alert>
        )}

        {!accountsQuery.isLoading && connectedAccounts.length === 0 && (
          <div className="space-y-3">
            <Alert>
              <AlertDescription>No social accounts connected yet.</AlertDescription>
            </Alert>
            <div className="flex justify-end">{connectButtons}</div>
          </div>
        )}

        {!accountsQuery.isLoading && connectedAccounts.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-muted-foreground text-sm">
                Connected:{' '}
                <span className="text-foreground font-medium">{connectedAccounts.length}</span>
              </div>
              {connectButtons}
            </div>

            <div className="text-muted-foreground text-xs">
              Drag to reorder. The top account is used as the default for new posts when no defaults
              are set.
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event) => {
                const overId = event.over?.id;
                const activeId = event.active?.id;
                if (typeof overId !== 'string' || typeof activeId !== 'string') return;
                if (overId === activeId) return;
                const next = moveId(orderedConnectedIds, activeId, overId);
                setOrderedConnectedIds(next);
                reorderAccountsMutation.mutate(next);
              }}
            >
              <div className="space-y-2">
                {orderedAccounts.map((account) => {
                  const canSync =
                    account.platform === 'instagram' || account.platform === 'facebook';
                  const isSyncing = syncPostsMutation.isPending && syncingAccountId === account.id;
                  return (
                    <SortableAccountRow
                      key={account.id}
                      account={account}
                      isPrimary={primarySocialAccountId === account.id}
                      isSyncing={isSyncing}
                      onSync={canSync ? () => syncPostsMutation.mutate(account) : null}
                      onDisconnect={() => handleDisconnect(account)}
                    />
                  );
                })}
              </div>
            </DndContext>

            <div className="space-y-2">
              <div className="text-sm font-medium">Defaults for new posts</div>
              <div className="space-y-1">
                <div className="text-muted-foreground text-xs">Destinations</div>
                <SocialAccountsPicker
                  options={defaultPostSocialAccountOptions}
                  value={defaultPostSocialAccountIds}
                  onChange={(value) => defaultAccountsMutation.mutate(value)}
                  disabled={defaultAccountsMutation.isPending}
                  addLabel="Add destination"
                  addTooltip="Add destination"
                  addButtonText="Add destination"
                  addButtonTextMode="always"
                  searchPlaceholder="Search accounts…"
                />
                {defaultPostSocialAccountIds.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    No defaults set — new posts will auto-select the top account.
                  </p>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    These accounts will be pre-selected when you create a new post.
                  </p>
                )}
              </div>
            </div>

            <Alert variant="info">
              <AlertDescription className="text-sm">
                Tip: Default accounts are optional. When none are set, new posts auto-select the top
                account.
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Candidate selection dialog */}
        <Dialog
          open={connectDialogOpen}
          onOpenChange={(open) => {
            setConnectDialogOpen(open);
            if (!open) {
              setConnectSessionId(null);
              setSelectedCandidateIds(new Set());
            }
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Select accounts to connect</DialogTitle>
              <DialogDescription>
                Choose which Instagram accounts and Facebook Pages to attach to {brand.name}. You
                can connect multiple.
              </DialogDescription>
            </DialogHeader>

            {(candidatesQuery.isLoading || candidatesQuery.isFetching) && (
              <div className="bg-muted h-40 animate-pulse rounded" />
            )}

            {!candidatesQuery.isLoading && isWaitingForCandidates && (
              <Alert>
                <AlertDescription>
                  Finishing Meta connection… If you just completed the pop-up, this can take a few
                  seconds.
                </AlertDescription>
              </Alert>
            )}

            {!candidatesQuery.isLoading && !isWaitingForCandidates && candidatesQuery.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {candidatesError?.message || 'Failed to load connectable accounts.'}
                </AlertDescription>
              </Alert>
            )}

            {!candidatesQuery.isLoading &&
              !isWaitingForCandidates &&
              !candidatesQuery.isError &&
              candidates.length === 0 && (
                <Alert>
                  <AlertDescription>
                    No connectable accounts were found for this Meta login.
                  </AlertDescription>
                </Alert>
              )}

            {!candidatesQuery.isLoading && candidates.length > 0 && (
              <ScrollArea className="h-[420px] pr-4">
                <div className="space-y-6">
                  {groupedCandidates.instagram.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Instagram accounts</div>
                      <div className="space-y-2">
                        {groupedCandidates.instagram.map((c) => {
                          const checked = selectedCandidateIds.has(c.candidateId);
                          const title = c.displayName || c.username || c.externalAccountId;
                          const subtitle = c.username ? `@${c.username}` : null;
                          return (
                            <label
                              key={c.candidateId}
                              className="bg-card flex cursor-pointer items-center gap-3 rounded-lg border p-3"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => toggleCandidate(c.candidateId, v === true)}
                              />
                              <ProfileAvatar
                                src={c.profilePictureUrl || null}
                                name={title}
                                alt={title}
                                size="md"
                              />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{title}</div>
                                {subtitle && (
                                  <div className="text-muted-foreground truncate text-xs">
                                    {subtitle}
                                  </div>
                                )}
                              </div>
                              <div className="ml-auto">
                                <Badge variant="secondary">Instagram</Badge>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {groupedCandidates.facebook.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Facebook Pages</div>
                      <div className="space-y-2">
                        {groupedCandidates.facebook.map((c) => {
                          const checked = selectedCandidateIds.has(c.candidateId);
                          const title = c.displayName || c.externalAccountId;
                          return (
                            <label
                              key={c.candidateId}
                              className="bg-card flex cursor-pointer items-center gap-3 rounded-lg border p-3"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => toggleCandidate(c.candidateId, v === true)}
                              />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{title}</div>
                                <div className="text-muted-foreground truncate text-xs">
                                  Page ID: {c.externalAccountId}
                                </div>
                              </div>
                              <div className="ml-auto">
                                <Badge variant="secondary">Facebook</Badge>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => {
                  setConnectDialogOpen(false);
                  setConnectSessionId(null);
                  setSelectedCandidateIds(new Set());
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => finalizeConnectMutation.mutate()}
                disabled={finalizeConnectMutation.isPending || selectedCandidateIds.size === 0}
              >
                {finalizeConnectMutation.isPending
                  ? 'Connecting…'
                  : `Connect selected (${selectedCandidateIds.size})`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Disconnect dialog */}
        <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect social account?</AlertDialogTitle>
              <AlertDialogDescription>
                This will stop publishing and syncing for this account. Choose whether to keep or
                remove posts that were imported from it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={disconnectMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={disconnectMutation.isPending || !disconnectTarget}
                onClick={() =>
                  disconnectTarget &&
                  disconnectMutation.mutate({
                    socialAccountId: disconnectTarget.id,
                    removeImportedPosts: false,
                  })
                }
              >
                Keep imported posts
              </AlertDialogAction>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={disconnectMutation.isPending || !disconnectTarget}
                onClick={() =>
                  disconnectTarget &&
                  disconnectMutation.mutate({
                    socialAccountId: disconnectTarget.id,
                    removeImportedPosts: true,
                  })
                }
              >
                Remove imported posts
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
