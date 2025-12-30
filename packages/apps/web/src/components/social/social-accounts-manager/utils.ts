import type { ConnectedAccount } from './types';

/**
 * Returns the list of allowed origins for postMessage communication.
 * Includes the current window origin and the API origin if configured.
 */
export function allowedMessageOrigins(): string[] {
  const origins = new Set<string>([window.location.origin]);

  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) {
    try {
      origins.add(new URL(apiUrl).origin);
    } catch {
      // Invalid URL - skip silently
    }
  }

  return [...origins];
}

type SocialAccountsQueryData = {
  socialAccounts?: ConnectedAccount[];
};

function isSocialAccountsQueryData(data: unknown): data is SocialAccountsQueryData {
  return (
    typeof data === 'object' &&
    data !== null &&
    (!('socialAccounts' in data) || Array.isArray((data as SocialAccountsQueryData).socialAccounts))
  );
}

/**
 * Safely extracts connected accounts from query data.
 * Returns an empty array if the data shape doesn't match expectations.
 */
export function getConnectedAccountsFromQueryData(data: unknown): ConnectedAccount[] {
  if (!isSocialAccountsQueryData(data)) {
    return [];
  }
  return data.socialAccounts ?? [];
}

export function startMetaOAuthPopup(params: {
  authUrl: string;
  initialConnectSessionId: string | null;
  allowedOrigins: string[];
  onDialogOpen: (connectSessionId: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}): boolean {
  const { authUrl, initialConnectSessionId, allowedOrigins, onDialogOpen, onError, onClose } =
    params;

  const popup = window.open(
    authUrl,
    'meta-oauth',
    'width=600,height=750,scrollbars=yes,resizable=yes'
  );
  if (!popup) {
    onError('Pop-up blocked. Please allow pop-ups and try again.');
    onClose();
    return false;
  }

  let isFinished = false;
  let didOpenDialog = false;

  const handleMessage = (event: MessageEvent) => {
    if (!allowedOrigins.includes(event.origin)) return;
    if (!event.data || typeof event.data.type !== 'string') return;

    if (event.data.type === 'META_OAUTH_SUCCESS') {
      const id = event.data?.data?.connectSessionId;
      if (typeof id === 'string' && id.trim()) {
        didOpenDialog = true;
        onDialogOpen(id);
      }
      finish();
    }

    if (event.data.type === 'META_OAUTH_ERROR') {
      onError(event.data?.data?.errorDescription || 'Meta connect failed');
      finish();
    }
  };

  const finish = () => {
    if (isFinished) return;
    isFinished = true;
    onClose();
    window.removeEventListener('message', handleMessage);
    window.clearInterval(checkClosed);
  };

  const checkClosed = window.setInterval(() => {
    if (!popup?.closed) return;

    if (!didOpenDialog && initialConnectSessionId) {
      didOpenDialog = true;
      onDialogOpen(initialConnectSessionId);
    }

    finish();
  }, 1000);

  window.addEventListener('message', handleMessage);

  return true;
}
