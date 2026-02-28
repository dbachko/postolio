export type SignupsMode = 'open' | 'closed' | 'allowlist' | 'invite_only';

export interface LoginAuthFlags {
  showGoogle: boolean;
  showFacebook: boolean;
  showOAuthProviders: boolean;
  magicLinkEnabled: boolean;
  signupsMode: SignupsMode;
  showRegisterLink: boolean;
  waitlistUrl?: string;
}

export function getLoginAuthFlags(): LoginAuthFlags {
  const googleEnabled = import.meta.env.VITE_AUTH_GOOGLE_ENABLED !== 'false';
  const facebookEnabled = import.meta.env.VITE_AUTH_FACEBOOK_ENABLED !== 'false';
  const magicLinkEnabled = import.meta.env.VITE_AUTH_MAGIC_LINK_ENABLED !== 'false';

  const googleConfigured = Boolean(
    import.meta.env.VITE_GOOGLE_CLIENT_ID && import.meta.env.VITE_GOOGLE_CLIENT_ID !== ''
  );
  const facebookConfigured = Boolean(
    import.meta.env.VITE_FACEBOOK_APP_ID && import.meta.env.VITE_FACEBOOK_APP_ID !== ''
  );

  const showGoogle = googleEnabled && googleConfigured;
  const showFacebook = facebookEnabled && facebookConfigured;
  const showOAuthProviders = showGoogle || showFacebook;

  const signupsMode = (import.meta.env.VITE_SIGNUPS_MODE || 'open') as SignupsMode;
  const showRegisterLink = signupsMode === 'open';
  const waitlistUrl = import.meta.env.VITE_WAITLIST_URL as string | undefined;

  return {
    showGoogle,
    showFacebook,
    showOAuthProviders,
    magicLinkEnabled,
    signupsMode,
    showRegisterLink,
    waitlistUrl,
  };
}
