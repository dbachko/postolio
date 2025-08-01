import { describe, it, expect, beforeEach } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Content } from '../frontend/src/pages/Content'
import { BrowserRouter } from 'react-router-dom'

// Mock the API client
jest.mock('../frontend/src/lib/api', () => ({
  apiClient: {
    getBrands: jest.fn(() => Promise.resolve({ brands: [{ id: 'brand-1', name: 'Test Brand' }] })),
    listCampaigns: jest.fn(() => Promise.resolve({ 
      success: true, 
      campaigns: [
        {
          id: 'campaign-1',
          name: 'Summer Campaign',
          status: 'active',
          brand: { id: 'brand-1', name: 'Test Brand' },
          contentCount: 5,
          config: {
            duration: { start: '2025-01-01', end: '2025-01-31' },
            frequency: 'daily'
          }
        }
      ]
    })),
    getCampaign: jest.fn(() => Promise.resolve({
      success: true,
      campaign: {
        id: 'campaign-1',
        content: [
          { id: 'post-1', caption: 'Test post', status: 'approved', scheduledAt: '2025-01-15' }
        ]
      }
    }))
  },
}))

// Mock the brand store
jest.mock('../frontend/src/stores/brandStore', () => ({
  useBrandStore: () => ({
    brands: [{ id: 'brand-1', name: 'Test Brand' }],
    selectedBrand: { id: 'brand-1', name: 'Test Brand' },
    setBrands: jest.fn(),
    initializeSelectedBrand: jest.fn(),
  }),
}))

describe('Content Page - TASK-25: Campaign Monitoring Dashboard', () => {
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

  it('should display campaign monitoring dashboard instead of tabs', async () => {
    renderContentPage()
    
    await waitFor(() => {
      // Should not have the old tab structure
      expect(screen.queryByText('Pending Approval')).not.toBeInTheDocument()
      expect(screen.queryByText('Content History')).not.toBeInTheDocument()
      expect(screen.queryByText('Calendar View')).not.toBeInTheDocument()
      
      // Should display campaign dashboard
      expect(screen.getByText('Campaign Dashboard')).toBeInTheDocument()
    })
  })

  it('should show active campaigns with content organized by campaign', async () => {
    renderContentPage()
    
    await waitFor(() => {
      // Should display campaign information
      expect(screen.getByText('Summer Campaign')).toBeInTheDocument()
      expect(screen.getByText('Test Brand')).toBeInTheDocument()
    })
  })

  it('should display campaign status and progress information', async () => {
    renderContentPage()
    
    await waitFor(() => {
      // Should show campaign status
      expect(screen.getByText(/active/i)).toBeInTheDocument()
      
      // Should show content count or progress information
      expect(screen.getByText(/5.*content/i) || screen.getByText(/posts/i)).toBeInTheDocument()
    })
  })

  it('should maintain Autopilot redirect functionality', async () => {
    renderContentPage()
    
    await waitFor(() => {
      // Should still have the "Go to Autopilot" functionality
      expect(screen.getByText('Go to Autopilot')).toBeInTheDocument()
    })
  })
})