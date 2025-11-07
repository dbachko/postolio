import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
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
// import Analytics from './pages/Analytics';
import Campaigns from './pages/Campaigns';
import { Content } from './pages/Content';
import { Settings } from './pages/Settings';
import { SecuritySettings } from './pages/SecuritySettings';
import { PrivacyPolicy } from './pages/PrivacyPolicy';
import { TermsOfService } from './pages/TermsOfService';
import { DataDeletion } from './pages/DataDeletion';
import UiKitchenSink from './pages/UiKitchenSink';
import { MagicLinkVerify } from './pages/MagicLinkVerify';
import NotFound from './pages/NotFound';
import { EmailVerify } from './pages/EmailVerify';
import { PasswordReset } from './pages/PasswordReset';
import { useEffect, lazy, Suspense, useRef } from 'react';
import { useTheme } from 'next-themes';
import { ErrorBoundary } from './components/ErrorBoundary';
import NotificationsPage from './pages/Notifications';
import { RouteError } from './components/RouteError';
const PostDetail = lazy(() => import('./pages/PostDetail'));
const CreatePost = lazy(() =>
  import('./pages/CreatePost').then((module) => ({
    default: module.CreatePost,
  }))
);
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
  {
    path: '/notifications',
    element: (
      <ProtectedRoute>
        <Layout>
          <NotificationsPage />
        </Layout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <Layout>
          <Dashboard />
        </Layout>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute>
        <Layout>
          <Dashboard />
        </Layout>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/brands',
    element: (
      <ProtectedRoute>
        <Layout>
          <Brands />
        </Layout>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/assets',
    element: (
      <ProtectedRoute>
        <Layout>
          <ErrorBoundary>
            <Assets />
          </ErrorBoundary>
        </Layout>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/assets/:assetId',
    element: (
      <ProtectedRoute>
        <Layout>
          <ErrorBoundary>
            <AssetDetail />
          </ErrorBoundary>
        </Layout>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/content',
    element: (
      <ProtectedRoute>
        <Layout>
          <Content />
        </Layout>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  // {
  //   path: '/analytics',
  //   element: (
  //     <ProtectedRoute>
  //       <Layout>
  //         <Analytics />
  //       </Layout>
  //     </ProtectedRoute>
  //   ),
  // },
  {
    path: '/drafts',
    element: (
      <ProtectedRoute>
        <Layout>
          <ErrorBoundary>
            <Suspense fallback={<LazyLoadingFallback />}>
              <Drafts />
            </Suspense>
          </ErrorBoundary>
        </Layout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/campaigns',
    element: (
      <ProtectedRoute>
        <Layout>
          <Campaigns />
        </Layout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/campaigns/create',
    element: (
      <ProtectedRoute>
        <Layout>
          <Campaigns />
        </Layout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/campaigns/:campaignId/edit',
    element: (
      <ProtectedRoute>
        <Layout>
          <Campaigns />
        </Layout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/campaigns/:campaignId',
    element: (
      <ProtectedRoute>
        <Layout>
          <Campaigns />
        </Layout>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/posts/:postId',
    element: (
      <ProtectedRoute>
        <Layout>
          <ErrorBoundary>
            <Suspense fallback={<LazyLoadingFallback minHeight="400px" />}>
              <PostDetail />
            </Suspense>
          </ErrorBoundary>
        </Layout>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/posts/create',
    element: (
      <ProtectedRoute>
        <Layout>
          <ErrorBoundary>
            <Suspense fallback={<LazyLoadingFallback minHeight="400px" />}>
              <CreatePost />
            </Suspense>
          </ErrorBoundary>
        </Layout>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/settings',
    element: (
      <ProtectedRoute>
        <Layout>
          <Settings />
        </Layout>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/security',
    element: (
      <ProtectedRoute>
        <Layout>
          <SecuritySettings />
        </Layout>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/limits',
    element: (
      <ProtectedRoute>
        <Layout>
          <ErrorBoundary>
            <Suspense fallback={<LazyLoadingFallback />}>
              <Limits />
            </Suspense>
          </ErrorBoundary>
        </Layout>
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/_ui',
    element: (
      <ProtectedRoute>
        <Layout>
          <UiKitchenSink />
        </Layout>
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
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ConnectionStatusProvider>
          <TimezoneProvider>
            <ThemeProvider
              attribute="class"
              enableSystem
              defaultTheme="system"
              storageKey="postolio-theme-mode"
              disableTransitionOnChange
            >
              <ThemeBootstrapper />
              <RouterProvider router={router} />
              <Toaster position="bottom-left" />
            </ThemeProvider>
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
