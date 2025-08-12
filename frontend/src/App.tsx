import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { useAuthStore } from './stores/authStore'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Brands } from './pages/Brands'
import { Content } from './pages/Content'
import Analytics from './pages/Analytics'
import InstagramAnalytics from './pages/InstagramAnalytics'
import Engagement from './pages/Engagement'
import { Growth } from './pages/Growth'
import { AIFeatures } from './pages/AIFeatures'
import { Autopilot } from './pages/Autopilot'
import { PrivacyPolicy } from './pages/PrivacyPolicy'
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
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
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
          <Route path="/content" element={
            <ProtectedRoute>
              <Layout>
                <Content />
              </Layout>
            </ProtectedRoute>
          } />
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
          <Route path="/autopilot" element={
            <ProtectedRoute>
              <Layout>
                <Autopilot />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/autopilot/campaign/:campaignId" element={
            <ProtectedRoute>
              <Layout>
                <Autopilot />
              </Layout>
            </ProtectedRoute>
          } />
        </Routes>
        <Toaster position="bottom-left" />
      </Router>
    </QueryClientProvider>
  )
}

export default App
