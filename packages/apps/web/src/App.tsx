import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { useAuthStore } from './stores/authStore';
import { TimezoneProvider } from './contexts/TimezoneContext';
import { ConnectionStatusProvider } from './contexts/WebSocketContext';
import { AppLayout as Layout } from './components/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Brands } from './pages/Brands';
import Analytics from './pages/Analytics';
import Campaigns from './pages/Campaigns';
import { Content } from './pages/Content';
import { Settings } from './pages/Settings';
import { SecuritySettings } from './pages/SecuritySettings';
import { PrivacyPolicy } from './pages/PrivacyPolicy';
import { TermsOfService } from './pages/TermsOfService';
import { DataDeletion } from './pages/DataDeletion';
import { MagicLinkVerify } from './pages/MagicLinkVerify';
import { EmailVerify } from './pages/EmailVerify';
import { PasswordReset } from './pages/PasswordReset';
import { useEffect, lazy, Suspense } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
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
        <div className="h-32 w-32 animate-spin rounded-full border-b-2 border-gray-900"></div>
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
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/register',
    element: <Register />,
  },
  {
    path: '/auth/magic-link',
    element: <MagicLinkVerify />,
  },
  {
    path: '/auth/verify-email',
    element: <EmailVerify />,
  },
  {
    path: '/password/reset',
    element: <PasswordReset />,
  },
  {
    path: '/privacy-policy',
    element: <PrivacyPolicy />,
  },
  {
    path: '/terms-of-service',
    element: <TermsOfService />,
  },
  {
    path: '/legal/data-deletion',
    element: <DataDeletion />,
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
  },
  {
    path: '/analytics',
    element: (
      <ProtectedRoute>
        <Layout>
          <Analytics />
        </Layout>
      </ProtectedRoute>
    ),
  },
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
            <RouterProvider router={router} />
            <Toaster position="bottom-left" />
          </TimezoneProvider>
        </ConnectionStatusProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
