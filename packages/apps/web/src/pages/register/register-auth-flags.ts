export type SignupsMode = 'open' | 'closed' | 'allowlist' | 'invite_only';

export interface RegisterAuthFlags {
  showGoogle: boolean;
  showFacebook: boolean;
  showOAuthProviders: boolean;
  magicLinkEnabled: boolean;
  signupsMode: SignupsMode;
  waitlistUrl?: string;
}

export function getRegisterAuthFlags(): RegisterAuthFlags {
  const googleEnabled = import.meta.env.VITE_AUTH_GOOGLE_ENABLED !== 'false';
  const facebookEnabled = import.meta.env.VITE_AUTH_FACEBOOK_ENABLED !== 'false';
  const magicLinkEnabled = import.meta.env.VITE_AUTH_MAGIC_LINK_ENABLED !== 'false';

  const googleConfigured = Boolean(
    import.meta.env.VITE_GOOGLE_CLIENT_ID && import.meta.env.VITE_GOOGLE_CLIENT_ID !== ''
  );
  const facebookConfigured = Boolean(
    import.meta.env.VITE_FACEBOOK_APP_ID && import.meta.env.VITE_FACEBOOK_APP_ID !== ''
  );

  return {
    showGoogle: googleEnabled && googleConfigured,
    showFacebook: facebookEnabled && facebookConfigured,
    showOAuthProviders:
      (googleEnabled && googleConfigured) || (facebookEnabled && facebookConfigured),
    magicLinkEnabled,
    signupsMode: (import.meta.env.VITE_SIGNUPS_MODE || 'open') as SignupsMode,
    waitlistUrl: import.meta.env.VITE_WAITLIST_URL as string | undefined,
  };
}
