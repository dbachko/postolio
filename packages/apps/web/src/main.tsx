import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import './index.css';
import App from './App.tsx';
import { GoogleOAuthProvider } from '@react-oauth/google';

const sentryDsn = import.meta.env.VITE_SENTRY_FRONTEND_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment:
      import.meta.env.VITE_ENVIRONMENT || (import.meta.env.MODE as string | undefined) || 'dev',
    tracesSampleRate: 0,
  });
}

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
