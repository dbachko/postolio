import { toast } from 'sonner';

export class OAuthError extends Error {
  constructor(
    message: string,
    public code:
      'CONFIG_MISSING' | 'SDK_LOAD_FAILED' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'USER_CANCELLED',
    public provider: 'google' | 'facebook'
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export function handleOAuthError(error: unknown, provider: 'google' | 'facebook') {
  let message = 'Authentication failed';
  let description = 'Please try again';

  if (error instanceof OAuthError) {
    switch (error.code) {
      case 'CONFIG_MISSING':
        message = `${provider === 'google' ? 'Google' : 'Facebook'} Sign-In not configured`;
        description = 'Contact support for assistance';
        break;
      case 'SDK_LOAD_FAILED':
        message = 'Failed to load authentication service';
        description = 'Check your internet connection and try again';
        break;
      case 'AUTH_FAILED':
        message = 'Authentication failed';
        description = error.message;
        break;
      case 'NETWORK_ERROR':
        message = 'Network error';
        description = 'Check your internet connection and try again';
        break;
      case 'USER_CANCELLED':
        message = 'Sign-in cancelled';
        description = 'You cancelled the sign-in process';
        break;
    }
  } else if (error instanceof Error) {
    description = error.message;
  }

  toast.error(message, {
    description,
  });
}

export async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on user cancellation or config errors
      if (
        error instanceof OAuthError &&
        (error.code === 'USER_CANCELLED' || error.code === 'CONFIG_MISSING')
      ) {
        throw error;
      }

      // Last attempt, throw the error
      if (i === maxRetries - 1) {
        throw error;
      }

      // Exponential backoff with jitter
      const delay = initialDelay * Math.pow(2, i);
      const jitter = Math.random() * delay * 0.1;
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }

  throw lastError;
}

export function getOAuthErrorFromResponse(response: Response): OAuthError | null {
  if (response.status === 401) {
    return new OAuthError(
      'Invalid credentials',
      'AUTH_FAILED',
      'google' // Will be overridden by caller
    );
  }

  if (response.status === 503 || response.status === 502) {
    return new OAuthError('Service temporarily unavailable', 'NETWORK_ERROR', 'google');
  }

  if (!response.ok) {
    return new OAuthError(`Server error: ${response.status}`, 'AUTH_FAILED', 'google');
  }

  return null;
}
