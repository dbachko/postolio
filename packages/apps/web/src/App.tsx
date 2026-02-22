import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useEffect, type ComponentProps, type ComponentType } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { ErrorBoundary } from '@/components/error-boundary';
import { router } from '@/app/router';
import { ThemeBootstrapper } from '@/app/theme-bootstrapper';
import { useAuthStore } from '@/stores/authStore';
import { ConnectionStatusProvider } from '@/contexts/WebSocketContext';
import { TimezoneProvider } from '@/contexts/TimezoneContext';
import { AuthInterceptor } from '@/lib/auth-interceptor';

const queryClient = new QueryClient();

function App() {
  const { checkAuth, isAuthenticated } = useAuthStore();
  type ThemeProviderProps = ComponentProps<typeof ThemeProvider>;
  const ThemeProviderShim = ThemeProvider as unknown as ComponentType<ThemeProviderProps>;

  useEffect(() => {
    // Skip auth check in minimal timezone render route to avoid API dependency in E2E
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    if (path.startsWith('/__tz')) {
      return;
    }
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (isAuthenticated) {
      AuthInterceptor.startAutoRefresh();
      return;
    }
    AuthInterceptor.stopAutoRefresh();
  }, [isAuthenticated]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ConnectionStatusProvider>
          <TimezoneProvider>
            <ThemeProviderShim
              attribute="class"
              enableSystem
              defaultTheme="system"
              storageKey="postolio-theme-mode"
              disableTransitionOnChange
            >
              <ThemeBootstrapper />
              <RouterProvider router={router} />
              <Toaster position="bottom-left" />
            </ThemeProviderShim>
          </TimezoneProvider>
        </ConnectionStatusProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
