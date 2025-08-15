import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBrandStore } from '../stores/brandStore'
import { useCalendarFilterStore } from '../stores/calendarFilterStore'
import { ContentCalendar } from '../components/ContentCalendar'
import { PageHeader } from '../components/PageHeader'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { AlertCircle, Calendar, ArrowLeft, Plus } from 'lucide-react'

export function Content() {
  const { selectedBrand } = useBrandStore()
  const navigate = useNavigate()
  const filters = useCalendarFilterStore()
  
  // Check if we're filtering by campaign(s)
  const isCampaignFiltered = filters.campaigns.length > 0

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
            {isCampaignFiltered && (
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
          isCampaignFiltered 
            ? `Viewing filtered content`
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
      {isCampaignFiltered && (
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
      />
    </div>
  )
}