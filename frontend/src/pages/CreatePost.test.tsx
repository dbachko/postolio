import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreatePost } from './CreatePost'

// Mock the brand store
jest.mock('../stores/brandStore', () => ({
  useBrandStore: () => ({
    selectedBrand: { id: 'test-brand', name: 'Test Brand' }
  })
}))

const renderWithProviders = (component: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {component}
      </BrowserRouter>
    </QueryClientProvider>
  )
}

describe('CreatePost', () => {
  it('should render the create post page with heading', () => {
    renderWithProviders(<CreatePost />)
    
    expect(screen.getByText(/Create New Post/i)).toBeInTheDocument()
  })
  
  it('should display the brand context', () => {
    renderWithProviders(<CreatePost />)
    
    expect(screen.getByText(/Test Brand/i)).toBeInTheDocument()
  })
  
  it('should have a back button for navigation', () => {
    renderWithProviders(<CreatePost />)
    
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
  })
})