import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, Star, Target, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { useBrandStore } from '@/stores/brandStore';
import { brand as brandApi, publishingQueues as publishingQueuesApi } from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';

import { AppEmptyState } from '@/components/app-empty-state';
import { SocialAccountQueueSettingsPanel } from '@/components/social/social-account-queue-settings-dialog/components/queue-settings-panel';
import type { SocialAccountOption } from '@/components/social/social-account-queue-settings-dialog/types';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import type { Platform } from '@/lib/platform-config';
import { formatSocialAccountHandle } from '@/lib/social-account-label';
import type { PublishingQueueSummary } from '@/lib/api/publishing-queues-client';

type ConnectedAccount = {
  id: string;
  platform: string;
  externalAccountId?: string | null;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  disconnected?: boolean;
};

type AccountOption = SocialAccountOption & { profilePictureUrl?: string | null };

function toAccountOption(a: ConnectedAccount): AccountOption {
  return {
    id: a.id,
    platform: a.platform,
    username: a.username ?? null,
    displayName: a.displayName ?? null,
    externalAccountId: a.externalAccountId ?? null,
    profilePictureUrl: a.profilePictureUrl ?? null,
  };
}

function accountTitle(account: AccountOption): string {
  return account.displayName || account.username || account.externalAccountId || account.id;
}

function accountSubtitle(account: AccountOption): string | null {
  if (account.username) {
    return formatSocialAccountHandle(account.platform, account.username);
  }
  if (account.externalAccountId) {
    return account.externalAccountId;
  }
  return null;
}

function preferredQueueId(queues: PublishingQueueSummary[]): string | null {
  return queues.find((queue) => queue.isDefault)?.id || queues[0]?.id || null;
}

function getQueueList(data: unknown): PublishingQueueSummary[] {
  const list = (data as { data?: { queues?: unknown } } | null)?.data?.queues;
  return Array.isArray(list) ? (list as PublishingQueueSummary[]) : [];
}

export function SocialAccountsPublishingSchedule() {
  const queryClient = useQueryClient();
  const selectedBrand = useBrandStore((s) => s.selectedBrand);

  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedQueueIdsByAccount, setSelectedQueueIdsByAccount] = useState<
    Record<string, string | null>
  >({});
  const [createQueueOpen, setCreateQueueOpen] = useState(false);
  const [newQueueName, setNewQueueName] = useState('');
  const [postingGoalOpen, setPostingGoalOpen] = useState(false);
  const [postingGoalValue, setPostingGoalValue] = useState<'1' | '3' | '5' | 'custom'>('3');
  const [postingGoalCustomValue, setPostingGoalCustomValue] = useState('4');
  const [postingGoalConfirmReplace, setPostingGoalConfirmReplace] = useState(false);
  const [queueToDelete, setQueueToDelete] = useState<{
    accountId: string;
    queueId: string;
    queueName: string;
  } | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['brand-social-accounts', selectedBrand?.id],
    queryFn: () => brandApi.getConnectedAccounts(selectedBrand!.id),
    enabled: Boolean(selectedBrand?.id),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const connectedAccounts = useMemo(() => {
    const data = accountsQuery.data as any;
    const list = Array.isArray(data?.socialAccounts)
      ? (data.socialAccounts as ConnectedAccount[])
      : [];
    return list.filter((a) => !a.disconnected);
  }, [accountsQuery.data]);

  const allAccountOptions = useMemo(
    () => connectedAccounts.map((a) => toAccountOption(a)),
    [connectedAccounts]
  );

  useEffect(() => {
    if (!connectedAccounts.length) {
      setSelectedAccountId('');
      return;
    }
    if (selectedAccountId && connectedAccounts.some((a) => a.id === selectedAccountId)) {
      return;
    }
    setSelectedAccountId(connectedAccounts[0]!.id);
  }, [connectedAccounts, selectedAccountId]);

  useEffect(() => {
    setCreateQueueOpen(false);
    setNewQueueName('');
    setPostingGoalOpen(false);
    setPostingGoalConfirmReplace(false);
    setQueueToDelete(null);
  }, [selectedAccountId]);

  const selectedAccount = useMemo(() => {
    if (!selectedAccountId) {
      return null;
    }
    return allAccountOptions.find((a) => a.id === selectedAccountId) || null;
  }, [allAccountOptions, selectedAccountId]);

  const selectedAccountQueuesQuery = useQuery({
    queryKey: ['publishing-queues', selectedAccount?.id],
    queryFn: () => publishingQueuesApi.listQueuesForSocialAccount(selectedAccount!.id),
    enabled: Boolean(selectedAccount?.id),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const selectedAccountQueues = useMemo(
    () => getQueueList(selectedAccountQueuesQuery.data),
    [selectedAccountQueuesQuery.data]
  );

  const selectedQueueId = selectedAccount
    ? selectedQueueIdsByAccount[selectedAccount.id] || null
    : null;
  const selectedQueue = useMemo(() => {
    if (!selectedAccountQueues.length) {
      return null;
    }
    const explicit = selectedQueueId
      ? selectedAccountQueues.find((queue) => queue.id === selectedQueueId) || null
      : null;
    return (
      explicit ||
      selectedAccountQueues.find((queue) => queue.isDefault) ||
      selectedAccountQueues[0] ||
      null
    );
  }, [selectedAccountQueues, selectedQueueId]);
  useEffect(() => {
    if (!postingGoalOpen) {
      setPostingGoalConfirmReplace(false);
    }
  }, [postingGoalOpen, selectedQueue?.id]);

  const selectedPostingGoalPerWeek = useMemo(() => {
    const raw =
      postingGoalValue === 'custom' ? postingGoalCustomValue.trim() : postingGoalValue.trim();
    if (!/^\d+$/.test(raw)) {
      return null;
    }
    const parsed = Number(raw);
    if (parsed < 1 || parsed > 21) {
      return null;
    }
    return parsed;
  }, [postingGoalCustomValue, postingGoalValue]);
  const postingGoalCustomError = useMemo(() => {
    if (postingGoalValue !== 'custom') {
      return null;
    }
    const raw = postingGoalCustomValue.trim();
    if (!raw) {
      return 'Enter a value between 1 and 21.';
    }
    if (!/^\d+$/.test(raw)) {
      return 'Use whole numbers only.';
    }
    const parsed = Number(raw);
    if (parsed < 1 || parsed > 21) {
      return 'Pick a value from 1 to 21.';
    }
    return null;
  }, [postingGoalCustomValue, postingGoalValue]);
  const selectedQueueSlotCount =
    selectedQueue && typeof selectedQueue.slotCount === 'number' ? selectedQueue.slotCount : 0;
  const requiresPostingGoalReplaceConfirm = selectedQueueSlotCount > 0;

  useEffect(() => {
    if (!selectedAccount?.id) {
      return;
    }
    if (selectedAccountQueuesQuery.isLoading) {
      return;
    }
    const currentQueueId = selectedQueueIdsByAccount[selectedAccount.id] || null;
    const exists =
      typeof currentQueueId === 'string' &&
      selectedAccountQueues.some((queue) => queue.id === currentQueueId);
    if (exists) {
      return;
    }
    const fallback = preferredQueueId(selectedAccountQueues);
    if (currentQueueId === fallback) {
      return;
    }
    setSelectedQueueIdsByAccount((prev) => {
      const prevValue = prev[selectedAccount.id] ?? null;
      if (prevValue === fallback) {
        return prev;
      }
      return { ...prev, [selectedAccount.id]: fallback };
    });
  }, [
    selectedAccount?.id,
    selectedAccountQueues,
    selectedAccountQueuesQuery.isLoading,
    selectedQueueIdsByAccount,
  ]);

  const createQueueMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAccount?.id) {
        throw new Error('Select a social account first');
      }
      const name = newQueueName.trim();
      if (!name) {
        throw new Error('Queue name is required');
      }
      return await publishingQueuesApi.createQueue(selectedAccount.id, name);
    },
    onSuccess: async (res) => {
      if (!selectedAccount?.id || !res.success || !res.data?.id) {
        toast.error('Failed to create queue');
        return;
      }

      queryClient.setQueryData(['publishing-queues', selectedAccount.id], (prev: any) => {
        const prevQueues = Array.isArray(prev?.data?.queues) ? prev.data.queues : [];
        if (prevQueues.some((queue: any) => queue?.id === res.data?.id)) {
          return prev;
        }
        const createdQueue = { ...res.data, slotCount: 0, itemCount: 0 };
        return {
          ...(prev || { success: true }),
          data: {
            ...(prev?.data || {}),
            socialAccountId: selectedAccount.id,
            queues: [...prevQueues, createdQueue],
          },
        };
      });

      toast.success('Queue created');
      setNewQueueName('');
      setCreateQueueOpen(false);
      setSelectedQueueIdsByAccount((prev) => {
        const nextQueueId = res.data!.id;
        const prevValue = prev[selectedAccount.id] ?? null;
        if (prevValue === nextQueueId) {
          return prev;
        }
        return { ...prev, [selectedAccount.id]: nextQueueId };
      });
      await queryClient.invalidateQueries({ queryKey: ['publishing-queues', selectedAccount.id] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create queue');
    },
  });

  const setDefaultQueueMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAccount?.id || !selectedQueue?.id) {
        throw new Error('Select a queue first');
      }
      return await publishingQueuesApi.updateQueue(selectedQueue.id, { isDefault: true });
    },
    onSuccess: async (res) => {
      if (!selectedAccount?.id || !res.success) {
        toast.error('Failed to set default queue');
        return;
      }

      toast.success('Default queue updated');
      await queryClient.invalidateQueries({ queryKey: ['publishing-queues', selectedAccount.id] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to set default queue');
    },
  });
  const setPostingGoalMutation = useMutation({
    mutationFn: async (payload: { queueId: string; postsPerWeek: number }) => {
      return await publishingQueuesApi.applyPostingGoal(payload.queueId, payload.postsPerWeek);
    },
    onSuccess: async (res, payload) => {
      if (!selectedAccount?.id) {
        return;
      }
      if (!res.success) {
        toast.error('Failed to apply cadence');
        return;
      }

      const createdSlots = typeof res.data?.createdSlots === 'number' ? res.data.createdSlots : 0;
      const conflictingSlots =
        typeof res.data?.conflictingSlots === 'number' ? res.data.conflictingSlots : 0;

      if (conflictingSlots > 0) {
        toast.success(
          `Cadence applied. Added ${createdSlots} slot${createdSlots === 1 ? '' : 's'} and skipped ${conflictingSlots} conflicting time${conflictingSlots === 1 ? '' : 's'}.`
        );
      } else {
        toast.success(
          `Cadence applied. Added ${createdSlots} weekly slot${createdSlots === 1 ? '' : 's'}.`
        );
      }

      setPostingGoalOpen(false);
      setPostingGoalConfirmReplace(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['publishing-queue-slots', payload.queueId],
        }),
        queryClient.invalidateQueries({ queryKey: ['publishing-queues', selectedAccount.id] }),
      ]);
    },
    onError: (error: unknown) => {
      const apiError = error as { data?: { error?: string } };
      const code = apiError?.data?.error;
      if (code === 'no_available_slots') {
        toast.error('No available times left for this account. Remove conflicting slots first.');
        return;
      }
      if (code === 'invalid_posts_per_week') {
        toast.error('Goal must be between 1 and 21 posts per week.');
        return;
      }
      if (code === 'slot_conflict') {
        toast.error('Schedule conflict detected. Try again.');
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Failed to apply cadence');
    },
  });

  const deleteQueueMutation = useMutation({
    mutationFn: async (payload: { accountId: string; queueId: string; queueName: string }) => {
      const res = await publishingQueuesApi.deleteQueue(payload.queueId);
      return { ...res, ...payload };
    },
    onSuccess: async (res) => {
      const { accountId, queueId, queueName } = res;
      if (!res.success) {
        const errorMessage =
          res.error === 'cannot_delete_default_queue'
            ? 'Default queue cannot be deleted.'
            : res.error === 'default_queue_not_found'
              ? 'Default queue not found for this social account.'
              : 'Failed to delete queue';
        toast.error(errorMessage);
        return;
      }

      let fallbackQueueId: string | null = null;
      queryClient.setQueryData(['publishing-queues', accountId], (prev: any) => {
        const prevQueues = Array.isArray(prev?.data?.queues) ? prev.data.queues : [];
        const nextQueues = prevQueues.filter((queue: any) => queue?.id !== queueId);
        fallbackQueueId = preferredQueueId(nextQueues as PublishingQueueSummary[]);
        return {
          ...(prev || { success: true }),
          data: {
            ...(prev?.data || {}),
            socialAccountId: accountId,
            queues: nextQueues,
          },
        };
      });

      setSelectedQueueIdsByAccount((prev) => {
        const current = prev[accountId] ?? null;
        if (current !== queueId) {
          return prev;
        }
        return { ...prev, [accountId]: fallbackQueueId };
      });
      setQueueToDelete(null);

      const movedItemsCount =
        typeof res?.data?.movedItemsCount === 'number' ? res.data.movedItemsCount : 0;
      if (movedItemsCount > 0) {
        toast.success(
          `Deleted "${queueName}". Moved ${movedItemsCount} queued post${movedItemsCount === 1 ? '' : 's'} to default queue.`
        );
      } else {
        toast.success(`Deleted "${queueName}".`);
      }

      await queryClient.invalidateQueries({ queryKey: ['publishing-queues', accountId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete queue');
    },
  });

  if (!selectedBrand) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AppEmptyState
          variant="minimal"
          title="Select a brand to manage social accounts"
          description="Choose which brand you want to manage to connect accounts and configure a publishing schedule."
          actions={[{ label: 'Choose Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {accountsQuery.isLoading ? (
          <div className="bg-muted h-20 animate-pulse rounded" />
        ) : allAccountOptions.length === 0 ? (
          <div className="text-muted-foreground text-sm">
            No connected accounts yet. Add one in Settings {'>'} Social Accounts first.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
            <div className="space-y-2">
              {allAccountOptions.map((account) => {
                const selected = account.id === selectedAccountId;
                const title = accountTitle(account);
                const subtitle = accountSubtitle(account);
                const activeQueueId = selectedQueueIdsByAccount[account.id] || null;

                return (
                  <div key={account.id} className="bg-card border-border rounded-lg border">
                    <Button
                      type="button"
                      onClick={() => setSelectedAccountId(account.id)}
                      variant="ghost"
                      className="h-auto w-full justify-start gap-3 rounded-lg p-3 text-left"
                    >
                      <SocialAccountAvatar
                        platform={account.platform as Platform}
                        name={title}
                        src={account.profilePictureUrl}
                        size="sm"
                        selected={false}
                        muted={false}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{title}</div>
                        {subtitle ? (
                          <div className="text-muted-foreground truncate text-xs">{subtitle}</div>
                        ) : null}
                      </div>
                    </Button>

                    {selected ? (
                      <div className="border-border space-y-1 border-t p-2">
                        <div className="text-muted-foreground px-2 text-[11px] font-medium tracking-wide uppercase">
                          Queues
                        </div>

                        {selectedAccountQueuesQuery.isLoading ? (
                          <div className="space-y-1 px-2 py-1">
                            <div className="bg-muted h-7 animate-pulse rounded" />
                            <div className="bg-muted h-7 animate-pulse rounded" />
                          </div>
                        ) : (
                          <>
                            {selectedAccountQueues.map((queue) => {
                              const queueSelected = queue.id === activeQueueId;
                              return (
                                <div
                                  key={queue.id}
                                  className={cn(
                                    'flex items-center gap-1 rounded-md border border-transparent px-1',
                                    queueSelected
                                      ? 'bg-accent border-primary/50 ring-primary/20 ring-1'
                                      : ''
                                  )}
                                >
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() =>
                                      setSelectedQueueIdsByAccount((prev) => {
                                        if (prev[account.id] === queue.id) {
                                          return prev;
                                        }
                                        return { ...prev, [account.id]: queue.id };
                                      })
                                    }
                                    className="h-auto flex-1 justify-between rounded-md border-0 px-1 py-1.5 text-left hover:bg-transparent"
                                  >
                                    <span className="truncate text-sm">{queue.name}</span>
                                    <span className="flex items-center gap-1">
                                      {queue.isDefault ? (
                                        <Badge variant="secondary" className="text-[10px]">
                                          Default
                                        </Badge>
                                      ) : null}
                                    </span>
                                  </Button>
                                  {queue.isDefault ? null : (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="text-muted-foreground hover:text-destructive h-7 w-7 shrink-0"
                                      aria-label={`Delete queue ${queue.name}`}
                                      title="Delete queue"
                                      disabled={deleteQueueMutation.isPending}
                                      onClick={() =>
                                        setQueueToDelete({
                                          accountId: account.id,
                                          queueId: queue.id,
                                          queueName: queue.name,
                                        })
                                      }
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              );
                            })}

                            <Popover open={createQueueOpen} onOpenChange={setCreateQueueOpen}>
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-foreground h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5"
                                  disabled={createQueueMutation.isPending}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  Create queue
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent align="start" className="w-72">
                                <div className="space-y-3">
                                  <div className="space-y-1">
                                    <div className="text-sm font-medium">Create queue</div>
                                    <div className="text-muted-foreground text-xs">
                                      Starts with an empty schedule.
                                    </div>
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Queue name</Label>
                                    <Input
                                      value={newQueueName}
                                      onChange={(e) => setNewQueueName(e.target.value)}
                                      placeholder="e.g. Evergreen"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key !== 'Enter') {
                                          return;
                                        }
                                        e.preventDefault();
                                        if (createQueueMutation.isPending) {
                                          return;
                                        }
                                        if (!newQueueName.trim()) {
                                          return;
                                        }
                                        createQueueMutation.mutate();
                                      }}
                                    />
                                  </div>
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      onClick={() => setCreateQueueOpen(false)}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      type="button"
                                      disabled={
                                        createQueueMutation.isPending || !newQueueName.trim()
                                      }
                                      onClick={() => createQueueMutation.mutate()}
                                    >
                                      Create
                                    </Button>
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold">Queue schedule</h2>
                  <p className="text-muted-foreground text-sm">
                    Manage weekly publishing slots for the selected queue.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/settings/social-accounts">Manage connections</Link>
                  </Button>
                  {selectedQueue ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={setPostingGoalMutation.isPending}
                      onClick={() => setPostingGoalOpen(true)}
                    >
                      <Target className="h-3.5 w-3.5" />
                      Plan cadence
                    </Button>
                  ) : null}
                  {selectedQueue && !selectedQueue.isDefault ? (
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={setDefaultQueueMutation.isPending}
                      onClick={() => setDefaultQueueMutation.mutate()}
                    >
                      <Star className="h-3.5 w-3.5" />
                      Set default
                    </Button>
                  ) : null}
                </div>
              </div>
              <SocialAccountQueueSettingsPanel
                account={selectedAccount}
                allAccounts={allAccountOptions}
                hideHeader
                selectedQueueId={selectedQueueId}
                onSelectedQueueIdChange={(queueId) => {
                  if (!selectedAccount?.id) {
                    return;
                  }
                  setSelectedQueueIdsByAccount((prev) => {
                    const prevValue = prev[selectedAccount.id] ?? null;
                    if (prevValue === queueId) {
                      return prev;
                    }
                    return { ...prev, [selectedAccount.id]: queueId };
                  });
                }}
              />
            </div>
          </div>
        )}
      </CardContent>
      <AlertDialog
        open={Boolean(queueToDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setQueueToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete queue</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{queueToDelete?.queueName}"?
              <br />
              Queued posts in this queue will be moved to the default queue. This queue&apos;s
              schedule slots will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteQueueMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteQueueMutation.isPending || !queueToDelete}
              onClick={() => {
                if (!queueToDelete) {
                  return;
                }
                deleteQueueMutation.mutate(queueToDelete);
              }}
            >
              {deleteQueueMutation.isPending ? 'Deleting…' : 'Delete queue'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={postingGoalOpen} onOpenChange={setPostingGoalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Plan weekly cadence</DialogTitle>
            <DialogDescription>
              Pick how often this queue should publish each week. We&apos;ll add open slots
              automatically.
            </DialogDescription>
          </DialogHeader>

          <RadioGroup value={postingGoalValue} onValueChange={(v) => setPostingGoalValue(v as any)}>
            <label
              className={cn(
                'border-border hover:bg-accent/40 flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 transition-colors',
                postingGoalValue === '1' ? 'border-primary bg-primary/5' : ''
              )}
            >
              <div className="flex min-w-0 flex-1 items-start gap-2.5 pr-3">
                <div className="text-muted-foreground shrink-0 text-xs leading-5 font-medium whitespace-nowrap">
                  🌱 1x/week
                </div>
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm leading-5 font-medium">Starter pace</div>
                  <div className="text-muted-foreground text-xs leading-4">
                    Light and consistent
                  </div>
                </div>
              </div>
              <RadioGroupItem value="1" />
            </label>
            <label
              className={cn(
                'border-border hover:bg-accent/40 flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 transition-colors',
                postingGoalValue === '3' ? 'border-primary bg-primary/5' : ''
              )}
            >
              <div className="flex min-w-0 flex-1 items-start gap-2.5 pr-3">
                <div className="text-muted-foreground shrink-0 text-xs leading-5 font-medium whitespace-nowrap">
                  📈 3x/week
                </div>
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm leading-5 font-medium">Steady pace</div>
                  <div className="text-muted-foreground text-xs leading-4">
                    Balanced weekly cadence
                  </div>
                </div>
              </div>
              <RadioGroupItem value="3" />
            </label>
            <label
              className={cn(
                'border-border hover:bg-accent/40 flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 transition-colors',
                postingGoalValue === '5' ? 'border-primary bg-primary/5' : ''
              )}
            >
              <div className="flex min-w-0 flex-1 items-start gap-2.5 pr-3">
                <div className="text-muted-foreground shrink-0 text-xs leading-5 font-medium whitespace-nowrap">
                  🚀 5x/week
                </div>
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm leading-5 font-medium">High pace</div>
                  <div className="text-muted-foreground text-xs leading-4">
                    Higher weekly volume
                  </div>
                </div>
              </div>
              <RadioGroupItem value="5" />
            </label>
            <label
              className={cn(
                'border-border hover:bg-accent/40 flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 transition-colors',
                postingGoalValue === 'custom' ? 'border-primary bg-primary/5' : ''
              )}
            >
              <div className="flex min-w-0 flex-1 items-start gap-2.5 pr-3">
                <div className="text-muted-foreground shrink-0 text-xs leading-5 font-medium whitespace-nowrap">
                  🎯 Custom
                </div>
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm leading-5 font-medium">Custom pace</div>
                  <div className="text-muted-foreground text-xs leading-4">
                    Choose your exact weekly volume
                  </div>
                </div>
              </div>
              <RadioGroupItem value="custom" />
            </label>
          </RadioGroup>

          {requiresPostingGoalReplaceConfirm ? (
            <div className="space-y-3">
              <Alert variant="warning" className="py-3">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Current schedule will be replaced</AlertTitle>
                <AlertDescription>
                  This queue currently has {selectedQueueSlotCount} slot
                  {selectedQueueSlotCount === 1 ? '' : 's'}. Applying cadence replaces those slots
                  with a new schedule.
                </AlertDescription>
              </Alert>
              <label
                htmlFor="posting-goal-replace-confirm"
                className="flex cursor-pointer items-start gap-2"
              >
                <Checkbox
                  id="posting-goal-replace-confirm"
                  checked={postingGoalConfirmReplace}
                  onCheckedChange={(checked) => setPostingGoalConfirmReplace(Boolean(checked))}
                />
                <span className="text-sm">I understand and want to replace existing slots.</span>
              </label>
            </div>
          ) : null}

          {postingGoalValue === 'custom' ? (
            <div className="space-y-2">
              <Label htmlFor="posting-goal-custom">Slots per week</Label>
              <Input
                id="posting-goal-custom"
                type="number"
                min={1}
                max={21}
                step={1}
                value={postingGoalCustomValue}
                onChange={(e) => setPostingGoalCustomValue(e.target.value)}
              />
              {postingGoalCustomError ? (
                <p className="text-destructive text-xs">{postingGoalCustomError}</p>
              ) : (
                <p className="text-muted-foreground text-xs">Allowed range: 1 to 21 slots/week.</p>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={setPostingGoalMutation.isPending}
              onClick={() => setPostingGoalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                setPostingGoalMutation.isPending ||
                !selectedQueue?.id ||
                selectedPostingGoalPerWeek === null ||
                (requiresPostingGoalReplaceConfirm && !postingGoalConfirmReplace)
              }
              onClick={() => {
                if (!selectedQueue?.id || selectedPostingGoalPerWeek === null) {
                  return;
                }
                setPostingGoalMutation.mutate({
                  queueId: selectedQueue.id,
                  postsPerWeek: selectedPostingGoalPerWeek,
                });
              }}
            >
              {setPostingGoalMutation.isPending ? 'Applying…' : 'Apply cadence'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
