import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import './index.css';
import App from './App.tsx';
import { GoogleOAuthProvider } from '@react-oauth/google';

const maybeReloadForChunkError = (reason: unknown) => {
  const key = 'postolio:reload-on-chunk-error';
  if (sessionStorage.getItem(key) === '1') {
    return;
  }

  const message =
    typeof reason === 'string'
      ? reason
      : reason && typeof reason === 'object' && 'message' in reason
        ? String((reason as { message?: unknown }).message ?? '')
        : '';

  if (!message) {
    return;
  }

  const isChunkLoadFailure =
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('ChunkLoadError');

  if (!isChunkLoadFailure) {
    return;
  }

  sessionStorage.setItem(key, '1');
  Sentry.captureException(reason);
  window.location.reload();
};

const sentryDsn = import.meta.env.VITE_SENTRY_FRONTEND_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment:
      import.meta.env.VITE_ENVIRONMENT || (import.meta.env.MODE as string | undefined) || 'dev',
    tracesSampleRate: 0,
  });
}

window.addEventListener('vite:preloadError', (event) => {
  maybeReloadForChunkError((event as unknown as { payload?: unknown })?.payload ?? event);
});

window.addEventListener('unhandledrejection', (event) => {
  maybeReloadForChunkError(event.reason);
});

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {clientId ? (
      <GoogleOAuthProvider clientId={clientId}>
        <App />
      </GoogleOAuthProvider>
    ) : (
      <App />
    )}
  </StrictMode>
);
