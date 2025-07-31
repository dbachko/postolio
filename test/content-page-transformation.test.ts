import { describe, it, expect, beforeEach } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Content } from '../frontend/src/pages/Content'
import { BrowserRouter } from 'react-router-dom'

// Mock the API client
jest.mock('../frontend/src/lib/api', () => ({
  apiClient: {
    getBrands: jest.fn(() => Promise.resolve({ brands: [] })),
    getPendingContent: jest.fn(() => Promise.resolve({ content: [] })),
    getContentHistory: jest.fn(() => Promise.resolve({ content: [] })),
    getLearningAnalytics: jest.fn(() => Promise.resolve({ analytics: {} })),
  },
}))

// Mock the brand store
jest.mock('../frontend/src/stores/brandStore', () => ({
  useBrandStore: () => ({
    brands: [],
    selectedBrand: { id: 'test-brand', name: 'Test Brand' },
    setBrands: jest.fn(),
    initializeSelectedBrand: jest.fn(),
  }),
}))

describe('Content Page - TASK-24: Remove Generation Functionality', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
  })

  const renderContentPage = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Content />
        </BrowserRouter>
      </QueryClientProvider>
    )
  }

  it('should not display Generate Content button', async () => {
    renderContentPage()
    
    await waitFor(() => {
      // Should not find "Generate Content" button
      expect(screen.queryByText('Generate Content')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /generate content/i })).not.toBeInTheDocument()
    })
  })

  it('should not display content generation form', async () => {
    renderContentPage()
    
    await waitFor(() => {
      // Should not find generation form elements
      expect(screen.queryByText('Generate New Content')).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/theme/i)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/style/i)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/count/i)).not.toBeInTheDocument()
    })
  })

  it('should not display AI learning insights section', async () => {
    renderContentPage()
    
    await waitFor(() => {
      // Should not find AI learning section
      expect(screen.queryByText('AI Learning Insights')).not.toBeInTheDocument()
      expect(screen.queryByText(/learning confidence/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/content acceptance/i)).not.toBeInTheDocument()
    })
  })

  it('should still display content viewing tabs', async () => {
    renderContentPage()
    
    await waitFor(() => {
      // Should still have content viewing functionality
      expect(screen.getByText('Pending Approval')).toBeInTheDocument()
      expect(screen.getByText('Content History')).toBeInTheDocument()
      expect(screen.getByText('Calendar View')).toBeInTheDocument()
    })
  })

  it('should direct users to Autopilot page for content generation', async () => {
    renderContentPage()
    
    await waitFor(() => {
      // Should have a message directing to Autopilot
      expect(screen.getByText(/use autopilot/i) || screen.getByText(/autopilot page/i)).toBeInTheDocument()
    })
  })
})