import type { SocialAccountOption } from '@/components/social/social-account-queue-settings-dialog/types';
import type { Platform } from '@/lib/platform-config';
import { formatSocialAccountHandle } from '@/lib/social-account-label';
import type { PublishingQueueSummary } from '@/lib/api/publishing-queues-client';
import type { ConversationState } from '@/lib/api/types';

export type ConnectedAccount = {
  id: string;
  platform: string;
  externalAccountId?: string | null;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  disconnected?: boolean;
};

export type AccountOption = SocialAccountOption & { profilePictureUrl?: string | null };

export type QueueToDelete = {
  accountId: string;
  queueId: string;
  queueName: string;
};

export type PostingGoalValue = '1' | '3' | '5' | 'custom';

export type SocialQueueAccount = {
  id: string;
  platform: Platform;
  externalAccountId?: string | null;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  disconnected?: boolean;
};

export type QueueConversationState = ConversationState;

export function toAccountOption(account: ConnectedAccount): AccountOption {
  return {
    id: account.id,
    platform: account.platform,
    username: account.username ?? null,
    displayName: account.displayName ?? null,
    externalAccountId: account.externalAccountId ?? null,
    profilePictureUrl: account.profilePictureUrl ?? null,
  };
}

export function accountTitle(account: AccountOption): string {
  return account.displayName || account.username || account.externalAccountId || account.id;
}

export function accountSubtitle(account: AccountOption): string | null {
  if (account.username) {
    return formatSocialAccountHandle(account.platform, account.username);
  }
  if (account.externalAccountId) {
    return account.externalAccountId;
  }
  return null;
}

export function preferredQueueId(queues: PublishingQueueSummary[]): string | null {
  return queues.find((queue) => queue.isDefault)?.id || queues[0]?.id || null;
}

export function getQueueList(data: unknown): PublishingQueueSummary[] {
  const list = (data as { data?: { queues?: unknown } } | null)?.data?.queues;
  return Array.isArray(list) ? (list as PublishingQueueSummary[]) : [];
}
