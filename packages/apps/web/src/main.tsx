import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AuthInterceptor } from './lib/auth-interceptor';

// Start automatic token refresh
AuthInterceptor.startAutoRefresh();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
