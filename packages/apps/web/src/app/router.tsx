import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppLayout as Layout } from '@/components/app-layout';
import { ErrorBoundary } from '@/components/error-boundary';
import { RouteError } from '@/components/route-error';

import { Login } from '@/pages/Login';
import { Register } from '@/pages/Register';
import { Dashboard } from '@/pages/dashboard';
import { Brands } from '@/pages/brands';
import { Assets } from '@/pages/Assets';
import AssetDetail from '@/pages/AssetDetail';
import Analytics from '@/pages/Analytics';
import AnalyticsAccount from '@/pages/AnalyticsAccount';
import Campaigns from '@/pages/Campaigns';
import { Content } from '@/pages/Content';
import { DMAutomation } from '@/pages/DMAutomation';
import { SocialAccountsConnections } from '@/pages/social-accounts/SocialAccountsConnections';
import { SocialAccountsPublishingSchedule } from '@/pages/social-accounts/SocialAccountsPublishingSchedule';
import { Settings } from '@/pages/Settings';
import { SecuritySettings } from '@/pages/SecuritySettings';
import { PrivacyPolicy } from '@/pages/PrivacyPolicy';
import { TermsOfService } from '@/pages/TermsOfService';
import { DataDeletion } from '@/pages/DataDeletion';
import { DataDeletionVerify } from '@/pages/DataDeletionVerify';
import AccountRecover from '@/pages/AccountRecover';
import UiKitchenSink from '@/pages/UiKitchenSink';
import { MagicLinkVerify } from '@/pages/MagicLinkVerify';
import NotFound from '@/pages/NotFound';
import { EmailVerify } from '@/pages/EmailVerify';
import { PasswordReset } from '@/pages/PasswordReset';
import TzRenderTest from '@/pages/TzRenderTest';
import NotificationsPage from '@/pages/Notifications';
import OnboardingPage from '@/pages/Onboarding';

import { ProtectedRoute, OnboardingGuard } from './guards';
import { LazyLoadingFallback } from './lazy-loading-fallback';
import { AppErrorFallback } from './error-fallbacks';
import { Drafts, Inbox, Limits, PostPage, SavedReplies, Snippets } from './lazy-pages';

type AppShellOptions = {
  onboarding?: boolean;
  suspenseMinHeight?: string;
  wrapSuspense?: boolean;
  wrapErrorBoundary?: boolean;
  errorBoundaryFallback?: ReactNode;
};

function appShell(element: ReactNode, options: AppShellOptions = {}) {
  const {
    onboarding = true,
    wrapSuspense = false,
    suspenseMinHeight,
    wrapErrorBoundary = false,
    errorBoundaryFallback,
  } = options;

  let content: ReactNode = element;

  if (wrapSuspense) {
    content = (
      <Suspense fallback={<LazyLoadingFallback minHeight={suspenseMinHeight} />}>
        {content}
      </Suspense>
    );
  }

  if (wrapErrorBoundary) {
    content = <ErrorBoundary fallback={errorBoundaryFallback}>{content}</ErrorBoundary>;
  }

  content = <Layout>{content}</Layout>;
  if (onboarding) content = <OnboardingGuard>{content}</OnboardingGuard>;

  return <ProtectedRoute>{content}</ProtectedRoute>;
}

export const router = createBrowserRouter([
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
    element: appShell(<Inbox />, {
      wrapErrorBoundary: true,
      wrapSuspense: true,
      suspenseMinHeight: '400px',
    }),
    errorElement: <RouteError />,
  },
  {
    path: '/inbox/comments',
    element: <Navigate to="/inbox" replace />,
    errorElement: <RouteError />,
  },
  { path: '/inbox/dms', element: <Navigate to="/inbox" replace />, errorElement: <RouteError /> },
  {
    path: '/inbox/saved-replies',
    element: appShell(<SavedReplies />, {
      wrapErrorBoundary: true,
      wrapSuspense: true,
      suspenseMinHeight: '400px',
    }),
    errorElement: <RouteError />,
  },
  {
    path: '/snippets',
    element: appShell(<Snippets />, {
      wrapErrorBoundary: true,
      wrapSuspense: true,
      suspenseMinHeight: '400px',
    }),
    errorElement: <RouteError />,
  },
  {
    path: '/notifications',
    element: appShell(<NotificationsPage />),
  },
  {
    path: '/',
    element: appShell(<Dashboard />),
    errorElement: <RouteError />,
  },
  {
    path: '/dashboard',
    element: appShell(<Dashboard />),
    errorElement: <RouteError />,
  },
  {
    path: '/brands',
    element: appShell(<Brands />),
    errorElement: <RouteError />,
  },
  {
    path: '/social-accounts',
    element: <Navigate to="/social-accounts/connections" replace />,
    errorElement: <RouteError />,
  },
  {
    path: '/social-accounts/connections',
    element: appShell(<SocialAccountsConnections />),
    errorElement: <RouteError />,
  },
  {
    path: '/social-accounts/weekly-calendar',
    element: <Navigate to="/social-accounts/publishing-schedule" replace />,
    errorElement: <RouteError />,
  },
  {
    path: '/social-accounts/publishing-schedule',
    element: appShell(<SocialAccountsPublishingSchedule />),
    errorElement: <RouteError />,
  },
  {
    path: '/assets',
    element: appShell(<Assets />, { wrapErrorBoundary: true }),
    errorElement: <RouteError />,
  },
  {
    path: '/assets/:assetId',
    element: appShell(<AssetDetail />, { wrapErrorBoundary: true }),
    errorElement: <RouteError />,
  },
  {
    path: '/content',
    element: appShell(<Content />),
    errorElement: <RouteError />,
  },
  {
    path: '/analytics',
    element: appShell(<Analytics />, {
      wrapErrorBoundary: true,
      errorBoundaryFallback: (
        <AppErrorFallback
          title="Analytics Error"
          description="Something went wrong loading the analytics page. Please refresh to try again."
        />
      ),
    }),
    errorElement: <RouteError />,
  },
  {
    path: '/analytics/accounts/:socialAccountId',
    element: appShell(<AnalyticsAccount />, {
      wrapErrorBoundary: true,
      errorBoundaryFallback: (
        <AppErrorFallback
          title="Account Analytics Error"
          description="Something went wrong loading account analytics. Please refresh to try again."
        />
      ),
    }),
    errorElement: <RouteError />,
  },
  {
    path: '/drafts',
    element: appShell(<Drafts />, { wrapErrorBoundary: true, wrapSuspense: true }),
  },
  {
    path: '/campaigns',
    element: appShell(<Campaigns />),
  },
  {
    path: '/dm-automation',
    element: appShell(<DMAutomation />, { onboarding: false }),
  },
  {
    path: '/campaigns/create',
    element: appShell(<Campaigns />),
  },
  {
    path: '/campaigns/:campaignId/edit',
    element: appShell(<Campaigns />),
  },
  {
    path: '/campaigns/:campaignId',
    element: appShell(<Campaigns />),
    errorElement: <RouteError />,
  },
  {
    path: '/posts/:postId',
    element: appShell(<PostPage />, {
      wrapErrorBoundary: true,
      wrapSuspense: true,
      suspenseMinHeight: '400px',
    }),
    errorElement: <RouteError />,
  },
  {
    path: '/posts/create',
    element: appShell(<PostPage />, {
      wrapErrorBoundary: true,
      wrapSuspense: true,
      suspenseMinHeight: '400px',
    }),
    errorElement: <RouteError />,
  },
  {
    path: '/settings',
    element: appShell(<Settings />),
    errorElement: <RouteError />,
  },
  {
    path: '/security',
    element: appShell(<SecuritySettings />),
    errorElement: <RouteError />,
  },
  {
    path: '/limits',
    element: appShell(<Limits />, { wrapErrorBoundary: true, wrapSuspense: true }),
    errorElement: <RouteError />,
  },
  {
    path: '/_ui',
    element: appShell(<UiKitchenSink />),
    errorElement: <RouteError />,
  },
  // Catch-all 404 for unmatched routes
  {
    path: '*',
    element: <NotFound />,
  },
]);
