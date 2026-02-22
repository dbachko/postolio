import type { SocialProfile } from './types';

export function getAccountTypeLabel(accountType: string): string {
  if (accountType === 'BUSINESS') {
    return 'Business';
  }
  if (accountType === 'CREATOR') {
    return 'Creator';
  }
  return accountType;
}

export function extractSocialProfile(connectionStatus: unknown): SocialProfile | null {
  const rawProfile =
    (connectionStatus as any)?.profile ?? (connectionStatus as any)?.account ?? null;
  if (!rawProfile?.username) {
    return null;
  }

  return {
    id: rawProfile.id ?? rawProfile.externalAccountId ?? '',
    username: rawProfile.username,
    account_type: rawProfile.account_type,
    name: rawProfile.name ?? rawProfile.displayName,
    followers_count: rawProfile.followers_count,
    media_count: rawProfile.media_count,
    biography: rawProfile.biography,
    profile_picture_url:
      rawProfile.profile_picture_url ?? rawProfile.profilePictureUrl ?? undefined,
  };
}
