import type { Platform } from '@/lib/platform-config';

export interface SocialAccountSummary {
  platform: Platform;
  label: string;
  avatarName: string;
  avatarUrl: string | null;
  disconnected: boolean;
}

export type SocialAccountsById = Record<string, SocialAccountSummary>;
