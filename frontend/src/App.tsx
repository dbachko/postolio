import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { useAuthStore } from './stores/authStore'
import { TimezoneProvider } from './contexts/TimezoneContext'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Brands } from './pages/Brands'
import Analytics from './pages/Analytics'
import InstagramAnalytics from './pages/InstagramAnalytics'
import Engagement from './pages/Engagement'
import { Growth } from './pages/Growth'
import { AIFeatures } from './pages/AIFeatures'
import { Campaigns } from './pages/Campaigns'
import { Settings } from './pages/Settings'
import { PrivacyPolicy } from './pages/PrivacyPolicy'
import { TermsOfService } from './pages/TermsOfService'
import { DataDeletion } from './pages/DataDeletion'
import { useEffect } from 'react'

const queryClient = new QueryClient()

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore()
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
      </div>
    )
  }
  
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />
}

function App() {
  const { checkAuth } = useAuthStore()
  
  useEffect(() => {
    checkAuth()
  }, [])
  
  return (
    <QueryClientProvider client={queryClient}>
      <TimezoneProvider>
        <Router>
          <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms-of-service" element={<TermsOfService />} />
          <Route path="/legal/data-deletion" element={<DataDeletion />} />
          <Route path="/" element={
            <ProtectedRoute>
              <Layout>
                <Dashboard />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Layout>
                <Dashboard />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/brands" element={
            <ProtectedRoute>
              <Layout>
                <Brands />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/content" element={<Navigate to="/campaigns" replace />} />
          <Route path="/analytics" element={
            <ProtectedRoute>
              <Layout>
                <Analytics />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/instagram-analytics" element={
            <ProtectedRoute>
              <Layout>
                <InstagramAnalytics />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/engagement" element={
            <ProtectedRoute>
              <Layout>
                <Engagement />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/growth" element={
            <ProtectedRoute>
              <Layout>
                <Growth />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/ai-features" element={
            <ProtectedRoute>
              <Layout>
                <AIFeatures />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/campaigns" element={
            <ProtectedRoute>
              <Layout>
                <Campaigns />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/campaigns/create" element={
            <ProtectedRoute>
              <Layout>
                <Campaigns />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/campaigns/:campaignId/edit" element={
            <ProtectedRoute>
              <Layout>
                <Campaigns />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/campaigns/:campaignId" element={
            <ProtectedRoute>
              <Layout>
                <Campaigns />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute>
              <Layout>
                <Settings />
              </Layout>
            </ProtectedRoute>
          } />
        </Routes>
        <Toaster position="bottom-left" />
      </Router>
      </TimezoneProvider>
    </QueryClientProvider>
  )
}

export default App
