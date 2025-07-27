import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { apiClient } from '../lib/api'
import { ContentCard } from '../components/ContentCard'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useBrandStore } from '../stores/brandStore'

export function Dashboard() {
  const { brands, selectedBrand, setBrands, initializeSelectedBrand } = useBrandStore()
  
  const { data: brandsData, isLoading: brandsLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: () => apiClient.getBrands(),
  })

  useEffect(() => {
    if (brandsData?.brands) {
      setBrands(brandsData.brands)
      initializeSelectedBrand(brandsData.brands)
    }
  }, [brandsData, setBrands, initializeSelectedBrand])

  const activeBrand = selectedBrand

  const { data: pendingContentData, isLoading: contentLoading } = useQuery({
    queryKey: ['pendingContent', activeBrand?.id],
    queryFn: () => activeBrand ? apiClient.getPendingContent(activeBrand.id) : null,
    enabled: !!activeBrand,
  })

  const pendingContent = pendingContentData?.content || []

  if (brandsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  if (brands.length === 0) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-foreground mb-4">Welcome to Instagram AI Agency</h2>
        <p className="text-muted-foreground mb-6">Get started by creating your first brand to begin generating content.</p>
        <Button asChild size="lg">
          <Link to="/brands">
            Create Your First Brand
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">
            {activeBrand ? `Managing content for ${activeBrand.name}` : 'No active brand selected'}
          </p>
        </div>
        <div className="flex space-x-3">
          <Button variant="outline" asChild>
            <Link to="/brands">
              Manage Brands
            </Link>
          </Button>
          <Button asChild>
            <Link to="/content">
              Generate Content
            </Link>
          </Button>
        </div>
      </div>

      {activeBrand && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                Pending Content Approval ({pendingContent.length})
              </CardTitle>
              {pendingContent.length > 0 && (
                <Button variant="link" asChild className="text-primary hover:underline text-sm">
                  <Link to="/content">
                    View All →
                  </Link>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {contentLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground"></div>
              </div>
            ) : pendingContent.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">No pending content to approve.</p>
                <Button asChild>
                  <Link to="/content">
                    Generate New Content
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {pendingContent.slice(0, 6).map((content) => (
                  <ContentCard
                    key={content.id}
                    content={content}
                    brandId={activeBrand.id}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Total Brands</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary">{brands.length}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Pending Approval</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-yellow-600">{pendingContent.length}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Active Brand</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg text-muted-foreground">{activeBrand?.name || 'None'}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}