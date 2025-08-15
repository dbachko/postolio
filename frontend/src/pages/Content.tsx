import { useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useBrandStore } from '../stores/brandStore'
import { ContentCalendar } from '../components/ContentCalendar'
import { PageHeader } from '../components/PageHeader'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { AlertCircle, Calendar, ArrowLeft, Plus } from 'lucide-react'

export function Content() {
  const { selectedBrand } = useBrandStore()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  
  // Get campaign filter from URL if present
  const campaignId = searchParams.get('campaign')
  const campaignName = searchParams.get('campaignName')

  // Redirect to dashboard if no brand selected
  useEffect(() => {
    if (!selectedBrand) {
      navigate('/dashboard')
    }
  }, [selectedBrand, navigate])

  if (!selectedBrand) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Please select a brand to view content calendar
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            {campaignId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/campaigns')}
                className="gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Campaigns
              </Button>
            )}
            <span>Content Calendar</span>
          </div>
        }
        description={
          campaignName 
            ? `Viewing content for campaign: ${campaignName}`
            : `View and manage scheduled content for ${selectedBrand.name}`
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => navigate('/campaigns/create')}
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              New Campaign
            </Button>
            <Button
              onClick={() => navigate('/campaigns')}
              className="gap-2"
            >
              <Calendar className="w-4 h-4" />
              Manage Campaigns
            </Button>
          </>
        }
      />

      {/* Campaign Filter Alert */}
      {campaignId && (
        <Alert>
          <Calendar className="h-4 w-4" />
          <AlertDescription>
            Showing content filtered by campaign. 
            <Button
              variant="link"
              size="sm"
              onClick={() => navigate('/content')}
              className="ml-2"
            >
              View all content
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Content Calendar Component */}
      <ContentCalendar 
        brandId={selectedBrand.id}
        brandName={selectedBrand.name}
        campaignFilter={campaignId}
      />
    </div>
  )
}