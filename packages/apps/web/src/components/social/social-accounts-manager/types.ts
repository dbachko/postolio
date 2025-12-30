import type { Brand } from '@/lib/api';

export type ConnectedAccount = {
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

export type MetaCandidate = {
  candidateId: string;
  platform: 'instagram' | 'facebook';
  externalAccountId: string;
  externalPageId?: string | null;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  metadata?: Record<string, unknown>;
};

export type SocialAccountsManagerProps = {
  brand: Brand;
  onAccountsChanged?: () => void;
};

export type ConnectIntent = 'instagram' | 'facebook';

export type SortableAccountRowProps = {
  account: ConnectedAccount;
  isPrimary: boolean;
  isSyncing: boolean;
  onSync: (() => void) | null;
  onQueueSettings: () => void;
  onDisconnect: () => void;
};
