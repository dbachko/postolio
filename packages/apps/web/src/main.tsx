import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AuthInterceptor } from './lib/auth-interceptor';
import { GoogleOAuthProvider } from '@react-oauth/google';

// Start automatic token refresh
AuthInterceptor.startAutoRefresh();

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
