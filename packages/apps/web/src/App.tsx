import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { useAuthStore } from './stores/authStore';
import { TimezoneProvider } from './contexts/TimezoneContext';
import { ConnectionStatusProvider } from './contexts/WebSocketContext';
import { ThemeProvider } from 'next-themes';
import { AppLayout as Layout } from './components/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Brands } from './pages/Brands';
import { Assets } from './pages/Assets';
import AssetDetail from './pages/AssetDetail';
import Analytics from './pages/Analytics';
import AnalyticsAccount from './pages/AnalyticsAccount';
import Campaigns from './pages/Campaigns';
import { Content } from './pages/Content';
import { DMAutomation } from './pages/DMAutomation';
import { SocialAccountsConnections } from './pages/social-accounts/SocialAccountsConnections';
import { SocialAccountsPublishingSchedule } from './pages/social-accounts/SocialAccountsPublishingSchedule';
import { Settings } from './pages/Settings';
import { SecuritySettings } from './pages/SecuritySettings';
import { PrivacyPolicy } from './pages/PrivacyPolicy';
import { TermsOfService } from './pages/TermsOfService';
import { DataDeletion } from './pages/DataDeletion';
import { DataDeletionVerify } from './pages/DataDeletionVerify';
import AccountRecover from './pages/AccountRecover';
import UiKitchenSink from './pages/UiKitchenSink';
import { MagicLinkVerify } from './pages/MagicLinkVerify';
import NotFound from './pages/NotFound';
import { EmailVerify } from './pages/EmailVerify';
import { PasswordReset } from './pages/PasswordReset';
import TzRenderTest from './pages/TzRenderTest';
import { useEffect, lazy, Suspense, useRef, type ComponentType } from 'react';
import { useTheme } from 'next-themes';
import { ErrorBoundary } from './components/ErrorBoundary';
import NotificationsPage from './pages/Notifications';
import { RouteError } from './components/RouteError';
import OnboardingPage from './pages/Onboarding';
import { useOnboardingStatus } from './hooks/useOnboardingStatus';
import { AuthInterceptor } from './lib/auth-interceptor';
const PostPage = lazy(() => import('./pages/Post'));
const InboxComments = lazy(() => import('./pages/InboxComments'));
const InboxDMs = lazy(() => import('./pages/InboxDMs'));
const SavedReplies = lazy(() => import('./pages/SavedReplies'));
const Limits = lazy(() => import('./pages/Limits'));
const Drafts = lazy(() => import('./pages/Drafts'));

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-32 w-32 animate-spin rounded-full border-b-2"></div>
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const { data: onboarding, isLoading } = useOnboardingStatus({
    enabled: isAuthenticated && !path.startsWith('/onboarding'),
  });

  if (!isAuthenticated) {
    return null;
  }

  if (path.startsWith('/onboarding')) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2" />
      </div>
    );
  }

  if (onboarding && (onboarding.status === 'no_brand' || onboarding.status === 'brand_no_social')) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

// Loading fallback for lazy routes
const LazyLoadingFallback = ({ minHeight = '200px' }: { minHeight?: string }) => (
  <div className="flex items-center justify-center" style={{ minHeight }}>
    <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2"></div>
  </div>
);

// Create router with data router API
const router = createBrowserRouter([
  { path: '/login', element: <Login />, errorElement: <RouteError /> },
  { path: '/register', element: <Register />, errorElement: <RouteError /> },
  { path: '/auth/magic-link', element: <MagicLinkVerify />, errorElement: <RouteError /> },
  { path: '/auth/verify-email', element: <EmailVerify />, errorElement: <RouteError /> },
  { path: '/password/reset', element: <PasswordReset />, errorElement: <RouteError /> },
  { path: '/privacy-policy', element: <PrivacyPolicy />, errorElement: <RouteError /> },
  { path: '/terms-of-service', element: <TermsOfService />, errorElement: <RouteError /> },
  { path: '/legal/data-deletion', element: <DataDeletion />, errorElement: <RouteError /> },
  { path: '/account/recover', element: <AccountRecover />, errorElement: <RouteError /> },
  {
    path: '/onboarding',
    element: (
      <ProtectedRoute>
        <OnboardingPage />
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/legal/data-deletion-verify',
    element: <DataDeletionVerify />,
    errorElement: <RouteError />,
  },
  // Dev/test-only: render a minimal PostPreviewCard for timezone validation
  { path: '/__tz', element: <TzRenderTest />, errorElement: <RouteError /> },
  {
    path: '/inbox',
    element: <Navigate to="/inbox/comments" replace />,
    errorElement: <RouteError />,
  },
  {
    path: '/inbox/comments',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <ErrorBoundary>
              <Suspense fallback={<LazyLoadingFallback minHeight="400px" />}>
                <InboxComments />
              </Suspense>
            </ErrorBoundary>
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/inbox/dms',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <ErrorBoundary>
              <Suspense fallback={<LazyLoadingFallback minHeight="400px" />}>
                <InboxDMs />
              </Suspense>
            </ErrorBoundary>
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/inbox/saved-replies',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <ErrorBoundary>
              <Suspense fallback={<LazyLoadingFallback minHeight="400px" />}>
                <SavedReplies />
              </Suspense>
            </ErrorBoundary>
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/notifications',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <NotificationsPage />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <Dashboard />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <Dashboard />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/brands',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <Brands />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/social-accounts',
    element: <Navigate to="/social-accounts/connections" replace />,
    errorElement: <RouteError />,
  },
  {
    path: '/social-accounts/connections',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <SocialAccountsConnections />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/social-accounts/weekly-calendar',
    element: <Navigate to="/social-accounts/publishing-schedule" replace />,
    errorElement: <RouteError />,
  },
  {
    path: '/social-accounts/publishing-schedule',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <SocialAccountsPublishingSchedule />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/assets',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <ErrorBoundary>
              <Assets />
            </ErrorBoundary>
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/assets/:assetId',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <ErrorBoundary>
              <AssetDetail />
            </ErrorBoundary>
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/content',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <Content />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/analytics',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <ErrorBoundary
              fallback={
                <div className="border-border bg-card flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-lg border p-8 text-center">
                  <div className="text-destructive">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-12 w-12"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold">Analytics Error</h3>
                    <p className="text-muted-foreground text-sm">
                      Something went wrong loading the analytics page. Please refresh to try again.
                    </p>
                  </div>
                  <Button type="button" onClick={() => window.location.reload()}>
                    Refresh Page
                  </Button>
                </div>
              }
            >
              <Analytics />
            </ErrorBoundary>
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/analytics/accounts/:socialAccountId',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <ErrorBoundary
              fallback={
                <div className="border-border bg-card flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-lg border p-8 text-center">
                  <div className="text-destructive">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-12 w-12"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold">Account Analytics Error</h3>
                    <p className="text-muted-foreground text-sm">
                      Something went wrong loading account analytics. Please refresh to try again.
                    </p>
                  </div>
                  <Button type="button" onClick={() => window.location.reload()}>
                    Refresh Page
                  </Button>
                </div>
              }
            >
              <AnalyticsAccount />
            </ErrorBoundary>
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/drafts',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <ErrorBoundary>
              <Suspense fallback={<LazyLoadingFallback />}>
                <Drafts />
              </Suspense>
            </ErrorBoundary>
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
  },
  {
    path: '/campaigns',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <Campaigns />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
  },
  {
    path: '/dm-automation',
    element: (
      <ProtectedRoute>
        <Layout>
          <DMAutomation />
        </Layout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/campaigns/create',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <Campaigns />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
  },
  {
    path: '/campaigns/:campaignId/edit',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <Campaigns />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
  },
  {
    path: '/campaigns/:campaignId',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <Campaigns />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/posts/:postId',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <ErrorBoundary>
              <Suspense fallback={<LazyLoadingFallback minHeight="400px" />}>
                <PostPage />
              </Suspense>
            </ErrorBoundary>
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/posts/create',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <ErrorBoundary>
              <Suspense fallback={<LazyLoadingFallback minHeight="400px" />}>
                <PostPage />
              </Suspense>
            </ErrorBoundary>
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/settings',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <Settings />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/security',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <SecuritySettings />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/limits',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <ErrorBoundary>
              <Suspense fallback={<LazyLoadingFallback />}>
                <Limits />
              </Suspense>
            </ErrorBoundary>
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/_ui',
    element: (
      <ProtectedRoute>
        <OnboardingGuard>
          <Layout>
            <UiKitchenSink />
          </Layout>
        </OnboardingGuard>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  // Catch-all 404 for unmatched routes
  {
    path: '*',
    element: <NotFound />,
  },
]);

function App() {
  const { checkAuth, isAuthenticated } = useAuthStore();
  type ThemeProviderProps = React.ComponentProps<typeof ThemeProvider>;
  const ThemeProviderShim = ThemeProvider as unknown as ComponentType<ThemeProviderProps>;

  useEffect(() => {
    // Skip auth check in minimal timezone render route to avoid API dependency in E2E
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    if (path.startsWith('/__tz')) return;
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

function ThemeBootstrapper() {
  const { user } = useAuthStore();
  const { setTheme } = useTheme();
  const didInit = useRef(false);
  useEffect(() => {
    // Only set theme from user once when the user data becomes available
    if (!user || didInit.current) return;
    didInit.current = true;
    if (user.theme) setTheme(user.theme);
  }, [user, setTheme]);
  return null;
}
