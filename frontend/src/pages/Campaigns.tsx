import { useState, useEffect, useCallback, useMemo } from 'react'
import { format } from 'date-fns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useBrandStore } from '../stores/brandStore'
import { apiClient, type CampaignConfig, type Content, type Campaign, type CampaignTemplate } from '../lib/api'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Alert, AlertDescription } from '../components/ui/alert'
import { PostEditor } from '../components/PostEditor'
import { TemplateSelector } from '../components/TemplateSelector'
import { SaveAsTemplateModal } from '../components/SaveAsTemplateModal'
import { CampaignAnalytics } from '../components/CampaignAnalytics'
import { CampaignComparison } from '../components/CampaignComparison'
import { CampaignsList } from '../components/CampaignsList'
import { CampaignForm } from '../components/CampaignForm'
import type { CampaignFormData, CampaignErrors } from '../types/campaign'
import { frequencyOptions, styleOptions } from '../constants/campaign'
import { useCampaignEdit } from '../hooks/useCampaignEdit'
import { 
  Loader2, Edit, Calendar, Users, TrendingUp, AlertCircle, Plus,
  FileText, Bookmark, BarChart3
} from 'lucide-react'


// Helper function to check if campaign ID is valid (not 'create')
const isRealCampaignId = (campaignId: string | undefined): boolean => {
  return !!campaignId && campaignId !== 'create'
}

const initialFormData: CampaignFormData = {
  name: '',
  startDate: '',
  endDate: '',
  frequency: '',
  themes: [],
  style: '',
  postingTime: '12:00',
  priority: 5
}


export function Campaigns() {
  const { campaignId: urlCampaignId } = useParams<{ campaignId?: string }>()
  const navigate = useNavigate()
  const { selectedBrand, setSelectedBrand, brands } = useBrandStore()
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<CampaignFormData>(initialFormData)
  const [errors, setErrors] = useState<CampaignErrors>({})
  
  // Determine initial view based on URL
  const getInitialView = () => {
    if (window.location.pathname.includes('/edit')) return 'edit'
    if (window.location.pathname === '/campaigns/create') return 'create'
    if (urlCampaignId && urlCampaignId !== 'create') return 'details'
    return 'dashboard'
  }
  
  // View state management
  const [currentView, setCurrentView] = useState<'dashboard' | 'create' | 'details' | 'edit'>(getInitialView())
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(urlCampaignId || null)
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null)
  
  // Modal state
  const [selectedPost, setSelectedPost] = useState<Content | null>(null)
  const [isPostEditorOpen, setIsPostEditorOpen] = useState(false)
  const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(false)
  const [templateSelectorMode, setTemplateSelectorMode] = useState<'create' | 'configure'>('create')
  const [isSaveAsTemplateOpen, setIsSaveAsTemplateOpen] = useState(false)
  const [saveAsTemplateCampaignId, setSaveAsTemplateCampaignId] = useState<string | null>(null)
  const [isFormPrefilledFromTemplate, setIsFormPrefilledFromTemplate] = useState(false)
  const [usedTemplateName, setUsedTemplateName] = useState<string | null>(null)
  const [isComparisonOpen, setIsComparisonOpen] = useState(false)
  const [pollingCampaigns, setPollingCampaigns] = useState<Set<string>>(new Set())

  // Campaign list query
  const campaignsQuery = useQuery({
    queryKey: ['campaigns', selectedBrand?.id],
    queryFn: () => apiClient.listCampaigns(selectedBrand?.id),
    enabled: !!selectedBrand
  })

  // URL-accessed campaign query for auto brand-switching
  const urlCampaignQuery = useQuery({
    queryKey: ['urlCampaign', urlCampaignId],
    queryFn: () => apiClient.getCampaign(urlCampaignId!),
    enabled: !!urlCampaignId
  })

  // Campaign details query for individual campaign view
  const campaignDetailsQuery = useQuery({
    queryKey: ['campaign', selectedCampaignId],
    queryFn: () => apiClient.getCampaign(selectedCampaignId!),
    enabled: !!selectedCampaignId && currentView === 'details'
  })

  // Campaign mutations - moved here to avoid conditional hook calls
  const configureMutation = useMutation({
    mutationFn: (config: CampaignConfig) => apiClient.configureCampaign(config),
    onSuccess: () => {
      toast.success('Campaign creation started! You can see the progress in the campaign list.')
      setCurrentView('dashboard')
      setFormData(initialFormData)
      setErrors({})
      navigate('/campaigns', { replace: true })
      campaignsQuery.refetch()
    },
    onError: (error) => {
      console.error('Failed to configure campaign:', error)
      toast.error('Failed to configure campaign. Please try again.')
    }
  })

  const startCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.startCampaign(campaignId),
    onSuccess: () => {
      toast.success('Campaign started successfully!')
      campaignsQuery.refetch()
    },
    onError: (error) => {
      console.error('Failed to start campaign:', error)
      toast.error('Failed to start campaign. Please try again.')
    }
  })

  const pauseCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.updateCampaign(campaignId, { status: 'paused' }),
    onSuccess: (data) => {
      toast.success(data.message || 'Campaign paused successfully!')
      campaignsQuery.refetch()
    },
  })

  const deleteCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.deleteCampaign(campaignId),
    onSuccess: () => {
      campaignsQuery.refetch()
      toast.success('Campaign deleted successfully')
    },
    onError: (error) => {
      console.error('Failed to delete campaign:', error)
      toast.error('Failed to delete campaign. Please try again.')
    }
  })

  // Handle URL changes and view state synchronization
  const location = useLocation()
  useEffect(() => {
    const pathname = location.pathname
    
    // Check for edit mode
    if (pathname.includes('/edit')) {
      const campaignId = pathname.split('/')[2]
      if (campaignId && campaignId !== 'create') {
        const campaign = campaignsQuery.data?.campaigns?.find((c: Campaign) => c.id === campaignId)
        if (campaign) {
          setEditingCampaign(campaign)
          setSelectedCampaignId(campaignId)
          setCurrentView('edit')
          setFormData({
            name: campaign.name,
            startDate: campaign.config?.duration?.start || '',
            endDate: campaign.config?.duration?.end || '',
            frequency: campaign.config?.frequency || 'daily',
            postingTime: campaign.config?.postingTime || '12:00',
            style: campaign.config?.style || 'lifestyle',
            themes: campaign.config?.themes || [],
            priority: campaign.priority || 5
          })
        }
      }
      return
    }
    
    // Check if we're at /campaigns (no specific campaign ID)
    if (pathname === '/campaigns' && !urlCampaignId) {
      setCurrentView('dashboard')
      setSelectedCampaignId(null)
    }
    // Check if we're at /campaigns/create
    else if (pathname === '/campaigns/create') {
      setCurrentView('create')
      setSelectedCampaignId(null)
    }
    // Check if we have a campaign ID in the URL
    else if (isRealCampaignId(urlCampaignId)) {
      setSelectedCampaignId(urlCampaignId!)
      setCurrentView('details')
    }
  }, [location.pathname, urlCampaignId, campaignsQuery.data?.campaigns])

  // Handle initial edit mode setup when directly accessing edit URL
  useEffect(() => {
    if (currentView === 'edit' && urlCampaignId && !editingCampaign && campaignsQuery.data?.campaigns) {
      const campaign = campaignsQuery.data.campaigns.find((c: Campaign) => c.id === urlCampaignId)
      if (campaign) {
        setEditingCampaign(campaign)
        setSelectedCampaignId(urlCampaignId)
        setFormData({
          name: campaign.name,
          startDate: campaign.config?.duration?.start || '',
          endDate: campaign.config?.duration?.end || '',
          frequency: campaign.config?.frequency || 'daily',
          postingTime: campaign.config?.postingTime || '12:00',
          style: campaign.config?.style || 'lifestyle',
          themes: campaign.config?.themes || [],
          priority: campaign.priority || 5
        })
      }
    }
  }, [currentView, urlCampaignId, editingCampaign, campaignsQuery.data?.campaigns])

  // Auto brand-switching effect when accessing campaign via URL
  useEffect(() => {
    if (isRealCampaignId(urlCampaignId) && urlCampaignQuery.data?.campaign) {
      const campaign = urlCampaignQuery.data.campaign
      const campaignBrandId = campaign.brandId || campaign.brand?.id
      
      // Check if we need to switch brands
      if (campaignBrandId && selectedBrand?.id !== campaignBrandId) {
        // Find the brand in our brands list
        const targetBrand = brands.find(brand => brand.id === campaignBrandId)
        if (targetBrand) {
          setSelectedBrand(targetBrand)
          toast.info(`Switched to brand: ${targetBrand.name}`)
        }
      }
    }
  }, [urlCampaignId, urlCampaignQuery.data, selectedBrand, brands, setSelectedBrand])


  // Polling effect for campaigns in "creating" status
  useEffect(() => {
    const campaigns = campaignsQuery.data?.campaigns || []
    const creatingCampaigns = campaigns.filter((c: Campaign) => c.status === 'creating' || c.status === 'processing')
    
    // Start polling for campaigns that need it
    creatingCampaigns.forEach((campaign: Campaign) => {
      if (!pollingCampaigns.has(campaign.id)) {
        setPollingCampaigns(prev => new Set(prev).add(campaign.id))
      }
    })

    // Stop polling for campaigns that are done
    pollingCampaigns.forEach(campaignId => {
      const campaign = campaigns.find((c: Campaign) => c.id === campaignId)
      if (!campaign || (campaign.status !== 'creating' && campaign.status !== 'processing')) {
        setPollingCampaigns(prev => {
          const newSet = new Set(prev)
          newSet.delete(campaignId)
          return newSet
        })
      }
    })
  }, [campaignsQuery.data?.campaigns, pollingCampaigns])

  // Polling interval
  useEffect(() => {
    if (pollingCampaigns.size === 0) return

    const pollCampaignStatus = async (campaignId: string) => {
      try {
        const response = await apiClient.getCampaignStatus(campaignId)
        if (response.success) {
          // Check if status changed to completed for notifications
          const oldData = queryClient.getQueryData(['campaigns', selectedBrand?.id]) as { campaigns: Campaign[] } | undefined
          const oldCampaign = oldData?.campaigns?.find((c: Campaign) => c.id === campaignId)
          const statusChanged = oldCampaign && oldCampaign.status !== response.status.status
          
          // Update the campaigns query data with new status
          queryClient.setQueryData(['campaigns', selectedBrand?.id], (oldData: { campaigns: Campaign[] } | undefined) => {
            if (!oldData) return oldData
            
            const updatedCampaigns = oldData.campaigns.map((campaign: Campaign) => 
              campaign.id === campaignId 
                ? { 
                    ...campaign, 
                    status: response.status.status,
                    progress: response.status.progress,
                    previewGenerated: response.status.previewGenerated,
                    errorMessage: response.status.errorMessage
                  }
                : campaign
            )
            
            return { ...oldData, campaigns: updatedCampaigns }
          })
          
          // Show notifications for status changes
          if (statusChanged) {
            const campaignName = oldCampaign?.name || 'Campaign'
            if (response.status.status === 'preview') {
              toast.success(`${campaignName} is ready to launch!`)
            } else if (response.status.status === 'failed') {
              toast.error(`${campaignName} generation failed: ${response.status.errorMessage}`)
            }
          }
        }
      } catch (error) {
        console.error(`Failed to poll campaign ${campaignId}:`, error)
      }
    }

    const interval = setInterval(() => {
      pollingCampaigns.forEach(campaignId => {
        pollCampaignStatus(campaignId)
      })
    }, 2000) // Poll every 2 seconds

    return () => clearInterval(interval)
  }, [pollingCampaigns, queryClient, selectedBrand?.id])

  // Memoized campaigns data to prevent unnecessary re-renders
  const campaigns = useMemo(() => 
    campaignsQuery.data?.campaigns || [], 
    [campaignsQuery.data?.campaigns]
  )

  // Event handlers with useCallback for performance
  const handleStartCampaign = useCallback((campaignId: string) => {
    // Check if this is a resume operation (campaign is paused)
    const campaign = campaigns.find(c => c.id === campaignId)
    if (campaign?.status === 'paused') {
      // Resume the paused campaign
      apiClient.updateCampaign(campaignId, { status: 'active' }).then((data) => {
        if (data.skippedCount && data.skippedCount > 0) {
          toast.info(data.message || `Campaign resumed. ${data.skippedCount} scheduled posts were skipped.`)
        } else {
          toast.success(data.message || 'Campaign resumed successfully!')
        }
        campaignsQuery.refetch()
      }).catch((error) => {
        console.error('Failed to resume campaign:', error)
        toast.error('Failed to resume campaign. Please try again.')
      })
    } else {
      // Normal start for preview campaigns
      startCampaignMutation.mutate(campaignId)
    }
  }, [startCampaignMutation, campaigns, campaignsQuery])

  const handlePauseCampaign = useCallback((campaignId: string) => {
    pauseCampaignMutation.mutate(campaignId)
  }, [pauseCampaignMutation])

  const handleDeleteCampaign = useCallback((campaignId: string, campaignName?: string) => {
    const confirmMessage = campaignName 
      ? `Are you sure you want to delete the campaign "${campaignName}"? This action cannot be undone.`
      : 'Are you sure you want to delete this campaign? This action cannot be undone.'
      
    if (confirm(confirmMessage)) {
      deleteCampaignMutation.mutate(campaignId)
    }
  }, [deleteCampaignMutation])

  const handleEditCampaign = useCallback((campaignId: string) => {
    const campaign = campaigns.find(c => c.id === campaignId)
    if (campaign) {
      setEditingCampaign(campaign)
      setSelectedCampaignId(campaignId)
      setCurrentView('edit')
      setFormData({
        name: campaign.name,
        startDate: campaign.config?.duration?.start || '',
        endDate: campaign.config?.duration?.end || '',
        frequency: campaign.config?.frequency || 'daily',
        postingTime: campaign.config?.postingTime || '12:00',
        style: campaign.config?.style || 'lifestyle',
        themes: campaign.config?.themes || [],
        priority: campaign.priority || 5
      })
      navigate(`/campaigns/${campaignId}/edit`)
    }
  }, [campaigns, navigate])

  const handleViewCampaignDetails = useCallback((campaignId: string) => {
    navigate(`/campaigns/${campaignId}`)
  }, [navigate])

  const handleCreateNewCampaign = useCallback(() => {
    // Reset form data to initial state when creating new campaign
    setFormData(initialFormData)
    setErrors({})
    setIsFormPrefilledFromTemplate(false)
    setUsedTemplateName(null)
    setCurrentView('create')
    navigate('/campaigns/create')
  }, [navigate])

  // Campaign edit hook
  const {
    isUpdating,
    handleEditSubmit: submitEdit,
    dialogs: editDialogs
  } = useCampaignEdit({
    campaignId: editingCampaign?.id || '',
    existingCampaign: editingCampaign,
    onEditComplete: () => {
      setCurrentView('dashboard')
      setEditingCampaign(null)
      navigate('/campaigns')
      campaignsQuery.refetch()
    }
  })

  // Wrapper for edit form submission
  const handleEditFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm() || !selectedBrand) {
      return
    }

    // Prepare edit data
    const editData = {
      name: formData.name,
      themes: formData.themes,
      style: formData.style,
      frequency: formData.frequency,
      postingTime: formData.postingTime,
      endDate: formData.endDate,
      priority: formData.priority
    }

    submitEdit(editData)
  }

  if (!selectedBrand) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Please select a brand to access campaign features
        </AlertDescription>
      </Alert>
    )
  }

  // TODO: Add campaign editing functionality later

  // Helper functions
  const validateForm = (): boolean => {
    const newErrors: CampaignErrors = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Campaign name is required'
    }

    if (!formData.startDate) {
      newErrors.startDate = 'Start date is required'
    }

    if (!formData.endDate) {
      newErrors.endDate = 'End date is required'
    }

    if (formData.startDate && formData.endDate) {
      const startDate = new Date(formData.startDate)
      const endDate = new Date(formData.endDate)
      if (endDate <= startDate) {
        newErrors.endDate = 'End date must be after start date'
      }
    }

    if (!formData.frequency) {
      newErrors.frequency = 'Posting frequency is required'
    }

    if (formData.themes.length === 0) {
      newErrors.themes = ['At least one theme is required']
    }

    if (!formData.style) {
      newErrors.style = 'Style selection is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const getTodayDate = () => {
    return format(new Date(), 'yyyy-MM-dd')
  }

  const getFrequencyLabel = (frequency: string) => {
    const option = frequencyOptions.find(opt => opt.value === frequency)
    return option ? option.label : frequency
  }

  const getStyleLabel = (style: string) => {
    const option = styleOptions.find(opt => opt.value === style)
    return option ? option.label : style
  }

  const getCampaignCardVariant = (status: string) => {
    switch (status) {
      case 'preview':
        return 'preview'
      case 'active':
        return 'active'
      case 'failed':
        return 'failed'
      case 'creating':
      case 'processing':
        return 'creating'
      case 'paused':
        return 'paused'
      default:
        return 'default'
    }
  }

  // Event handlers
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm() || !selectedBrand) {
      return
    }

    const campaignConfig: CampaignConfig = {
      name: formData.name,
      brandId: selectedBrand.id,
      duration: {
        // Send date strings directly instead of converting to Date objects
        // This prevents timezone issues with Date constructor
        start: formData.startDate,
        end: formData.endDate
      },
      frequency: formData.frequency,
      themes: formData.themes,
      style: formData.style,
      postingTime: formData.postingTime,
      priority: formData.priority
    }

    configureMutation.mutate(campaignConfig)
  }

  const handleInputChange = (field: keyof CampaignFormData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }

  const addTheme = (theme: string) => {
    if (theme && !formData.themes.includes(theme)) {
      const updatedThemes = [...formData.themes, theme]
      setFormData(prev => ({ ...prev, themes: updatedThemes }))
      // Clear themes error
      if (errors.themes) {
        setErrors(prev => ({ ...prev, themes: undefined }))
      }
    }
  }

  const removeTheme = (themeToRemove: string) => {
    const updatedThemes = formData.themes.filter(theme => theme !== themeToRemove)
    setFormData(prev => ({ ...prev, themes: updatedThemes }))
  }


  const handleEditPost = (post: Content) => {
    setSelectedPost(post)
    setIsPostEditorOpen(true)
  }

  const handleUseTemplate = () => {
    setTemplateSelectorMode('create')
    setIsTemplateSelectorOpen(true)
  }

  const handleTemplateSelected = (campaignId: string) => {
    // TODO: Use campaignId to navigate to specific campaign if needed
    console.log('Campaign created from template:', campaignId)
    setIsTemplateSelectorOpen(false)
    setCurrentView('dashboard')
    campaignsQuery.refetch()
    toast.success('Campaign created from template successfully!')
  }

  const handleSaveAsTemplate = (campaignId: string) => {
    setSaveAsTemplateCampaignId(campaignId)
    setIsSaveAsTemplateOpen(true)
  }

  const handleTemplateSaved = () => {
    setIsSaveAsTemplateOpen(false)
    setSaveAsTemplateCampaignId(null)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
        <p className="text-gray-600 mt-1">
          {currentView === 'dashboard' 
            ? `Manage automated content campaigns for ${selectedBrand.name}`
            : currentView === 'create' 
            ? `Create new automated content campaign for ${selectedBrand.name}`
            : currentView === 'edit'
            ? `Edit campaign for ${selectedBrand.name}`
            : `View campaign details for ${selectedBrand.name}`
          }
        </p>
      </div>

      {/* Dashboard View */}
      {currentView === 'dashboard' && (
        <>
          {/* Action Header */}
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4">
                <div className="space-y-1">
                  <CardTitle>Campaign Management</CardTitle>
                  <CardDescription>
                    Monitor active campaigns and manage your content pipeline
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => setIsComparisonOpen(true)}
                    disabled={!campaigns.length || campaigns.filter(c => ['active', 'completed', 'paused'].includes(c.status)).length < 2}
                    className="flex items-center gap-2"
                  >
                    <BarChart3 className="w-4 h-4" />
                    Compare Campaigns
                  </Button>
                  <Button variant="outline" onClick={handleUseTemplate} className="flex items-center gap-2 bg-blue-50 border-blue-200 hover:bg-blue-100">
                    <FileText className="w-4 h-4 text-blue-600" />
                    Use Template
                  </Button>
                  <Button onClick={handleCreateNewCampaign} className="flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    Create New Campaign
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Campaign Dashboard */}
          {campaignsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="ml-2">Loading campaigns...</span>
            </div>
          ) : campaignsQuery.error ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to load campaigns. Please try again.
              </AlertDescription>
            </Alert>
          ) : !campaigns.length ? (
            <div className="text-center py-12">
              <div className="mb-4">
                <Calendar className="w-12 h-12 mx-auto text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No campaigns yet</h3>
              <p className="text-gray-600 mb-4">
                Create your first automated content campaign to get started.
              </p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" onClick={handleUseTemplate} className="flex items-center gap-2 bg-blue-50 border-blue-200 hover:bg-blue-100">
                  <FileText className="w-4 h-4 text-blue-600" />
                  Use Template
                </Button>
                <Button onClick={handleCreateNewCampaign} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Create New Campaign
                </Button>
              </div>
            </div>
          ) : (
            <CampaignsList
              campaigns={campaigns}
              onViewCampaignDetails={handleViewCampaignDetails}
              onStartCampaign={handleStartCampaign}
              onPauseCampaign={handlePauseCampaign}
              onDeleteCampaign={handleDeleteCampaign}
              onEditCampaign={handleEditCampaign}
              startCampaignLoading={startCampaignMutation.isPending}
              pauseCampaignLoading={pauseCampaignMutation.isPending}
              deleteCampaignLoading={deleteCampaignMutation.isPending}
            />
          )}
        </>
      )}

      {/* Create Campaign View */}
      {currentView === 'create' && (
        <CampaignForm
          formData={formData}
          errors={errors}
          isSubmitting={configureMutation.isPending}
          isFormPrefilledFromTemplate={isFormPrefilledFromTemplate}
          usedTemplateName={usedTemplateName}
          onSubmit={handleSubmit}
          onInputChange={handleInputChange}
          onAddTheme={addTheme}
          onRemoveTheme={removeTheme}
          onBackToDashboard={() => {
            setCurrentView('dashboard')
            setFormData(initialFormData)
            setErrors({})
            setIsFormPrefilledFromTemplate(false)
            setUsedTemplateName(null)
            navigate('/campaigns', { replace: true })
          }}
          onUseTemplate={handleUseTemplate}
        />
      )}

      {/* Edit Campaign View */}
      {currentView === 'edit' && editingCampaign && (
        <>
          <CampaignForm
            mode="edit"
            existingCampaign={editingCampaign}
            formData={formData}
            errors={errors}
            isSubmitting={isUpdating}
            onSubmit={handleEditFormSubmit}
            onInputChange={handleInputChange}
            onAddTheme={addTheme}
            onRemoveTheme={removeTheme}
            onBackToDashboard={() => {
              setCurrentView('dashboard')
              setEditingCampaign(null)
              navigate('/campaigns', { replace: true })
            }}
            onCancel={() => {
              setCurrentView('dashboard')
              setEditingCampaign(null)
              navigate('/campaigns', { replace: true })
            }}
          />
          {editDialogs}
        </>
      )}

      {/* Campaign Details View */}
      {currentView === 'details' && campaignDetailsQuery.data?.campaign && (
        <>
          {/* Campaign Details Header */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Campaign Details</CardTitle>
                  <CardDescription>
                    View campaign configuration and generated content
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => {
                    setCurrentView('dashboard')
                    setSelectedCampaignId(null)
                    navigate('/campaigns', { replace: true })
                  }}>
                    ← All Campaigns
                  </Button>
                  <div className="flex gap-2">
                    {(['preview', 'creating', 'failed'].includes(campaignDetailsQuery.data.campaign.status)) && (
                      <Button 
                        variant="outline" 
                        onClick={() => handleEditCampaign(campaignDetailsQuery.data.campaign.id)}
                        className="flex items-center gap-2"
                      >
                        <Edit className="w-4 h-4" />
                        Edit Campaign
                      </Button>
                    )}
                    <Button 
                      variant="outline" 
                      onClick={() => handleSaveAsTemplate(campaignDetailsQuery.data.campaign.id)}
                      className="flex items-center gap-2"
                    >
                      <Bookmark className="w-4 h-4" />
                      Save as Template
                    </Button>
                  </div>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Campaign Overview */}
          {(() => {
            const campaign = campaignDetailsQuery.data.campaign
            const config = campaign.config

            return (
              <>
                <Card variant={getCampaignCardVariant(campaign.status)}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>{campaign.name}</CardTitle>
                        <CardDescription>Campaign overview and metrics</CardDescription>
                      </div>
                      <Badge 
                        variant={
                          campaign.status === 'active' ? 'default' :
                          campaign.status === 'preview' ? 'default' :
                          campaign.status === 'paused' ? 'outline' :
                          'secondary'
                        }
                      >
                        {campaign.status === 'preview' ? 'ready to launch' : campaign.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                      <Card>
                        <CardContent className="flex items-center gap-3 p-4">
                          <Calendar className="w-5 h-5 text-blue-600" />
                          <div>
                            <p className="text-sm text-muted-foreground">Duration</p>
                            <p className="font-semibold">
                              {Math.ceil(
                                (new Date(config.duration.end).getTime() - 
                                 new Date(config.duration.start).getTime()) 
                                / (1000 * 60 * 60 * 24)
                              )} days
                            </p>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardContent className="flex items-center gap-3 p-4">
                          <TrendingUp className="w-5 h-5 text-green-600" />
                          <div>
                            <p className="text-sm text-muted-foreground">Content Created</p>
                            <p className="font-semibold">
                              {campaign.content?.length || 0} posts
                            </p>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardContent className="flex items-center gap-3 p-4">
                          <Users className="w-5 h-5 text-purple-600" />
                          <div>
                            <p className="text-sm text-muted-foreground">Frequency</p>
                            <p className="font-semibold">
                              {getFrequencyLabel(config.frequency)}
                            </p>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardContent className="flex items-center gap-3 p-4">
                          <div className="w-5 h-5 bg-orange-600 rounded-full" />
                          <div>
                            <p className="text-sm text-muted-foreground">Style</p>
                            <p className="font-semibold">
                              {getStyleLabel(config.style)}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <h3 className="font-medium mb-2">Campaign Details</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Start Date:</span>
                            <span className="font-medium">
                              {format(new Date(config.duration.start), 'MMM d, yyyy')}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">End Date:</span>
                            <span className="font-medium">
                              {format(new Date(config.duration.end), 'MMM d, yyyy')}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Posting Time:</span>
                            <span className="font-medium">{config.postingTime}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Priority:</span>
                            <span className="font-medium">
                              {campaign.priority === 1 ? '🔴 Urgent (1)' :
                               campaign.priority === 2 ? '🟠 High (2)' :
                               campaign.priority === 3 ? '🟡 Medium-High (3)' :
                               campaign.priority === 4 ? '🟢 Medium (4)' :
                               campaign.priority === 5 ? '🔵 Normal (5)' :
                               campaign.priority === 6 ? '⚪ Low (6)' :
                               campaign.priority === 7 ? '⚫ Very Low (7)' :
                               `Priority ${campaign.priority || 5}`}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Created:</span>
                            <span className="font-medium">
                              {format(new Date(campaign.createdAt), 'MMM d, yyyy')}
                            </span>
                          </div>
                          {campaign.startedAt && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Started:</span>
                              <span className="font-medium">
                                {format(new Date(campaign.startedAt), 'MMM d, yyyy')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <h3 className="font-medium mb-2">Content Themes</h3>
                        <div className="flex flex-wrap gap-2">
                          {config.themes?.map((theme: string, index: number) => (
                            <Badge key={index} variant="secondary">
                              {theme}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Start Campaign Button for preview_ready campaigns */}
                {campaign.status === 'preview' && (
                  <Card>
                    <CardContent className="flex items-center justify-between p-6">
                      <div>
                        <CardTitle className="text-lg">Ready to Launch?</CardTitle>
                        <CardDescription className="mt-1">
                          Your campaign preview is ready. Start the campaign to begin automated content posting.
                        </CardDescription>
                      </div>
                      <Button
                        onClick={() => {
                          if (campaign.id) {
                            startCampaignMutation.mutate(campaign.id)
                          }
                        }}
                        disabled={startCampaignMutation.isPending}
                        className="bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700"
                      >
                        {startCampaignMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Starting Campaign...
                          </>
                        ) : (
                          'Start Campaign'
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Campaign Analytics */}
                {(campaign.status === 'active' || campaign.status === 'completed' || campaign.status === 'paused') && (
                  <CampaignAnalytics 
                    campaignId={campaign.id} 
                    campaignName={campaign.name} 
                  />
                )}

                {/* Campaign Content */}
                <Card>
                  <CardHeader>
                    <CardTitle>Generated Content</CardTitle>
                    <CardDescription>
                      {campaign.content?.length || 0} posts generated for this campaign
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!campaign.content || campaign.content.length === 0 ? (
                      <div className="text-center py-8">
                        <div className="mb-4">
                          <Calendar className="w-12 h-12 mx-auto text-gray-400" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No content generated yet</h3>
                        <p className="text-gray-600">
                          {campaign.status === 'preview' 
                            ? 'Start this campaign to begin automated content posting.'
                            : 'Content will appear here as it gets generated.'
                          }
                        </p>
                      </div>
                    ) : (
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {campaign.content.map((post: Content) => (
                          <Card key={post.id}>
                            {(post.cdnImageUrl || post.imageUrl) && (
                              <div className="aspect-w-16 aspect-h-9">
                                <img
                                  src={post.cdnImageUrl || post.imageUrl || ''}
                                  alt={`Post ${post.id}`}
                                  className="w-full h-48 object-cover rounded-t-lg"
                                />
                              </div>
                            )}
                            
                            <CardContent className="p-4">
                              <div className="mb-3">
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge 
                                    variant={
                                      post.status === 'approved' ? 'default' :
                                      post.status === 'pending' ? 'secondary' :
                                      post.status === 'published' ? 'default' :
                                      'outline'
                                    }
                                  >
                                    {post.status}
                                  </Badge>
                                  {post.scheduledAt && (
                                    <span className="text-xs text-muted-foreground">
                                      {format(new Date(post.scheduledAt), 'MMM d, HH:mm')}
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm leading-relaxed overflow-hidden" style={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 3,
                                  WebkitBoxOrient: 'vertical'
                                }}>
                                  {post.caption}
                                </p>
                              </div>

                              {post.hashtags && post.hashtags.length > 0 && (
                                <div className="mb-4">
                                  <div className="flex flex-wrap gap-1">
                                    {post.hashtags.slice(0, 3).map((tag: string, tagIndex: number) => (
                                      <Badge key={tagIndex} variant="secondary" className="text-xs">
                                        #{tag}
                                      </Badge>
                                    ))}
                                    {post.hashtags.length > 3 && (
                                      <span className="text-xs text-muted-foreground">
                                        +{post.hashtags.length - 3} more
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}

                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditPost(post)}
                                  className="flex-1"
                                >
                                  <Edit className="w-3 h-3 mr-1" />
                                  Edit
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )
          })()}
        </>
      )}

      {/* Loading states */}
      {campaignDetailsQuery.isLoading && currentView === 'details' && (
        <Card>
          <CardContent className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading campaign details...
          </CardContent>
        </Card>
      )}

      {campaignDetailsQuery.error && currentView === 'details' && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load campaign details. Please try again.
          </AlertDescription>
        </Alert>
      )}

      {/* Post Editor Modal */}
      <PostEditor
        content={selectedPost}
        isOpen={isPostEditorOpen}
        onClose={() => {
          setIsPostEditorOpen(false)
          setSelectedPost(null)
        }}
      />

      {/* Template Selector Modal */}
      {selectedBrand && (
        <TemplateSelector
          open={isTemplateSelectorOpen}
          onOpenChange={setIsTemplateSelectorOpen}
          brandId={selectedBrand.id}
          onTemplateSelected={handleTemplateSelected}
          onTemplateForConfiguration={(template: CampaignTemplate) => {
            // Pre-fill form with template data
            const templateConfig = template.config || {}
            const today = getTodayDate()
            const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
            
            // Type-safe frequency handling
            const templateFrequency = templateConfig.frequency
            const safeFrequency = (templateFrequency && 
              ['daily', 'every2days', '3weekly'].includes(templateFrequency)) 
              ? templateFrequency as 'daily' | 'every2days' | '3weekly'
              : '' as const
            
            setFormData({
              name: `${template.name} Campaign`,
              startDate: today,
              endDate: format(endDate, 'yyyy-MM-dd'),
              frequency: safeFrequency,
              themes: templateConfig.themes || [],
              style: templateConfig.style || '',
              postingTime: templateConfig.postingTime || '12:00',
              priority: templateConfig.priority || 5
            })
            
            setIsTemplateSelectorOpen(false)
            setCurrentView('create')
            setIsFormPrefilledFromTemplate(true)
            setUsedTemplateName(template.name)
            toast.success(`Campaign form pre-filled with "${template.name}" template settings!`)
          }}
          mode={templateSelectorMode}
        />
      )}

      {/* Save as Template Modal */}
      {saveAsTemplateCampaignId && (
        <SaveAsTemplateModal
          open={isSaveAsTemplateOpen}
          onOpenChange={setIsSaveAsTemplateOpen}
          campaignId={saveAsTemplateCampaignId}
          onTemplateSaved={handleTemplateSaved}
        />
      )}

      {/* Campaign Comparison Modal */}
      <CampaignComparison
        campaigns={campaigns}
        isOpen={isComparisonOpen}
        onClose={() => setIsComparisonOpen(false)}
      />
    </div>
  )
}