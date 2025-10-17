import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Removed GoogleOAuthProvider - using isolated implementation
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
import InstagramAnalytics from './pages/InstagramAnalytics';
import Engagement from './pages/Engagement';
import { Growth } from './pages/Growth';
import { AIFeatures } from './pages/AIFeatures';
import { Campaigns } from './pages/Campaigns';
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
            <Router>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/auth/magic-link" element={<MagicLinkVerify />} />
                <Route path="/auth/verify-email" element={<EmailVerify />} />
                <Route path="/password/reset" element={<PasswordReset />} />
                <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                <Route path="/terms-of-service" element={<TermsOfService />} />
                <Route path="/legal/data-deletion" element={<DataDeletion />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Dashboard />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Dashboard />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/brands"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Brands />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/content"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Content />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/analytics"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Analytics />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/instagram-analytics"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <InstagramAnalytics />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/engagement"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Engagement />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/growth"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Growth />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/ai-features"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <AIFeatures />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/campaigns"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Campaigns />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/campaigns/create"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Campaigns />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/campaigns/:campaignId/edit"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Campaigns />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/campaigns/:campaignId"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Campaigns />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/posts/:postId"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <ErrorBoundary>
                          <Suspense
                            fallback={
                              <div className="flex min-h-[400px] items-center justify-center">
                                <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2"></div>
                              </div>
                            }
                          >
                            <PostDetail />
                          </Suspense>
                        </ErrorBoundary>
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/posts/create"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <ErrorBoundary>
                          <Suspense
                            fallback={
                              <div className="flex min-h-[400px] items-center justify-center">
                                <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2"></div>
                              </div>
                            }
                          >
                            <CreatePost />
                          </Suspense>
                        </ErrorBoundary>
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Settings />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/security"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <SecuritySettings />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
              </Routes>
              <Toaster position="bottom-left" />
            </Router>
          </TimezoneProvider>
        </ConnectionStatusProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
