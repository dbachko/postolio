import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useParams, useNavigate } from 'react-router-dom'
import { useBrandStore } from '../stores/brandStore'
import { apiClient, type CampaignConfig, type CampaignPreview, type Content } from '../lib/api'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Alert, AlertDescription } from '../components/ui/alert'
import { PostEditor } from '../components/PostEditor'
import { TemplateSelector } from '../components/TemplateSelector'
import { SaveAsTemplateModal } from '../components/SaveAsTemplateModal'
import { CampaignAnalytics } from '../components/CampaignAnalytics'
import { CampaignComparison } from '../components/CampaignComparison'
import { Loader2, Edit, Calendar, Users, TrendingUp, X, AlertCircle, Plus, List, Eye, Pause, Play, Trash2, FileText, Bookmark, BarChart3 } from 'lucide-react'
interface CampaignFormData {
  name: string
  startDate: string
  endDate: string
  frequency: 'daily' | 'every2days' | '3weekly' | ''
  themes: string[]
  style: string
  postingTime: string
  priority: number
}

interface CampaignErrors {
  name?: string
  startDate?: string
  endDate?: string
  frequency?: string
  themes?: string[]
  style?: string
  postingTime?: string
  priority?: string
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

const frequencyOptions = [
  { value: 'daily', label: 'Daily' },
  { value: 'every2days', label: 'Every 2 Days' },
  { value: '3weekly', label: '3x Weekly' }
]

const styleOptions = [
  { value: 'modern', label: 'Modern & Minimalist' },
  { value: 'vibrant', label: 'Vibrant & Colorful' },
  { value: 'professional', label: 'Professional & Corporate' },
  { value: 'casual', label: 'Casual & Friendly' },
  { value: 'luxury', label: 'Luxury & Premium' },
  { value: 'vintage', label: 'Vintage & Retro' }
]

const commonThemes = [
  'product showcase',
  'behind the scenes',
  'customer stories',
  'tips & tutorials',
  'industry insights',
  'company culture',
  'seasonal content',
  'user generated content'
]

export function Autopilot() {
  const { campaignId: urlCampaignId } = useParams()
  const navigate = useNavigate()
  const { selectedBrand, setSelectedBrand, brands } = useBrandStore()
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<CampaignFormData>(initialFormData)
  const [errors, setErrors] = useState<CampaignErrors>({})
  const [newTheme, setNewTheme] = useState('')
  const [currentStep, setCurrentStep] = useState<'list' | 'configure' | 'preview' | 'details'>('list')
  const [campaignPreview, setCampaignPreview] = useState<CampaignPreview | null>(null)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [selectedPost, setSelectedPost] = useState<Content | null>(null)
  const [isPostEditorOpen, setIsPostEditorOpen] = useState(false)
  const [pollingCampaigns, setPollingCampaigns] = useState<Set<string>>(new Set())
  const [isEditingCampaign, setIsEditingCampaign] = useState(false)
  const [editFormData, setEditFormData] = useState<CampaignFormData>(initialFormData)
  const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(false)
  const [templateSelectorMode, setTemplateSelectorMode] = useState<'create' | 'configure'>('create')
  const [isSaveAsTemplateOpen, setIsSaveAsTemplateOpen] = useState(false)
  const [saveAsTemplateCampaignId, setSaveAsTemplateCampaignId] = useState<string | null>(null)
  const [isFormPrefilledFromTemplate, setIsFormPrefilledFromTemplate] = useState(false)
  const [usedTemplateName, setUsedTemplateName] = useState<string | null>(null)
  const [isComparisonOpen, setIsComparisonOpen] = useState(false)
  
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

  // Auto brand-switching effect when accessing campaign via URL
  useEffect(() => {
    if (urlCampaignId && urlCampaignQuery.data?.campaign) {
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
      
      // Set the campaign as selected and navigate to details
      setSelectedCampaignId(urlCampaignId)
      setCurrentStep('details')
      
      // Update URL to remove campaign ID to avoid conflicts
      navigate('/autopilot', { replace: true })
    }
  }, [urlCampaignId, urlCampaignQuery.data, selectedBrand, brands, setSelectedBrand, navigate])

  // Polling effect for campaigns in "creating" status
  useEffect(() => {
    const campaigns = campaignsQuery.data?.campaigns || []
    const creatingCampaigns = campaigns.filter((c: any) => c.status === 'creating' || c.status === 'processing')
    
    // Start polling for campaigns that need it
    creatingCampaigns.forEach((campaign: any) => {
      if (!pollingCampaigns.has(campaign.id)) {
        setPollingCampaigns(prev => new Set(prev).add(campaign.id))
      }
    })

    // Stop polling for campaigns that are done
    pollingCampaigns.forEach(campaignId => {
      const campaign = campaigns.find((c: any) => c.id === campaignId)
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
          const oldData = queryClient.getQueryData(['campaigns', selectedBrand?.id]) as any
          const oldCampaign = oldData?.campaigns?.find((c: any) => c.id === campaignId)
          const statusChanged = oldCampaign && oldCampaign.status !== response.status.status
          
          // Update the campaigns query data with new status
          queryClient.setQueryData(['campaigns', selectedBrand?.id], (oldData: any) => {
            if (!oldData) return oldData
            
            const updatedCampaigns = oldData.campaigns.map((campaign: any) => 
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

  // Campaign details query
  const campaignDetailsQuery = useQuery({
    queryKey: ['campaign', selectedCampaignId],
    queryFn: () => apiClient.getCampaign(selectedCampaignId!),
    enabled: !!selectedCampaignId && currentStep === 'details'
  })

  // Delete campaign mutation
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

  // Update campaign mutation
  const updateCampaignMutation = useMutation({
    mutationFn: ({ campaignId, updates }: { campaignId: string; updates: any }) => 
      apiClient.updateCampaign(campaignId, updates),
    onSuccess: () => {
      toast.success('Campaign updated successfully')
      setIsEditingCampaign(false)
      campaignsQuery.refetch()
      campaignDetailsQuery.refetch()
    },
    onError: (error) => {
      console.error('Failed to update campaign:', error)
      toast.error('Failed to update campaign. Please try again.')
    }
  })
  
  // Configure campaign mutation
  const configureMutation = useMutation({
    mutationFn: (config: CampaignConfig) => apiClient.configureCampaign(config),
    onSuccess: () => {
      // Campaign created successfully - redirect to list view to show progress
      toast.success('Campaign creation started! You can see the progress in the campaign list.')
      setCurrentStep('list')
      setCampaignPreview(null)
      setFormData(initialFormData)
      setErrors({})
      campaignsQuery.refetch()
    },
    onError: (error) => {
      console.error('Failed to configure campaign:', error)
      toast.error('Failed to configure campaign. Please try again.')
    }
  })


  // Start campaign mutation
  const startCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.startCampaign(campaignId),
    onSuccess: () => {
      toast.success('Campaign started successfully!')
      // Reset to list view and refresh campaigns
      setCurrentStep('list')
      setCampaignPreview(null)
      setFormData(initialFormData)
      setErrors({})
      campaignsQuery.refetch()
    },
    onError: (error) => {
      console.error('Failed to start campaign:', error)
      toast.error('Failed to start campaign. Please try again.')
    }
  })

  if (!selectedBrand) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Please select a brand to access Autopilot features
        </AlertDescription>
      </Alert>
    )
  }

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm() || !selectedBrand) {
      return
    }

    const campaignConfig: CampaignConfig = {
      name: formData.name,
      brandId: selectedBrand.id,
      duration: {
        start: new Date(formData.startDate),
        end: new Date(formData.endDate)
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

  const handleAddCustomTheme = () => {
    if (newTheme.trim()) {
      addTheme(newTheme.trim())
      setNewTheme('')
    }
  }

  const getTodayDate = () => {
    return format(new Date(), 'yyyy-MM-dd')
  }

  const handleEditPost = (post: Content) => {
    setSelectedPost(post)
    setIsPostEditorOpen(true)
  }

  const handleBackToConfiguration = () => {
    setCurrentStep('configure')
    setCampaignPreview(null)
  }

  const handleBackToList = () => {
    setCurrentStep('list')
    setCampaignPreview(null)
    setFormData(initialFormData)
    setErrors({})
    setIsFormPrefilledFromTemplate(false)
    setUsedTemplateName(null)
  }

  const handleCreateNewCampaign = () => {
    setCurrentStep('configure')
    setFormData(initialFormData)
    setErrors({})
    setIsFormPrefilledFromTemplate(false)
    setUsedTemplateName(null)
  }

  const handleUseTemplate = () => {
    setTemplateSelectorMode('create')
    setIsTemplateSelectorOpen(true)
  }

  const handleUseTemplateForConfig = () => {
    setTemplateSelectorMode('configure')
    setIsTemplateSelectorOpen(true)
  }

  const handleTemplateSelected = (_campaignId: string) => {
    setIsTemplateSelectorOpen(false)
    setCurrentStep('list')
    // Refresh campaigns to show the new template-based campaign
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

  const handleTemplateForConfiguration = (template: any) => {
    // Pre-fill form with template data
    const templateConfig = template.config
    const today = getTodayDate()
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
    
    setFormData({
      name: `${template.name} Campaign`,
      startDate: today,
      endDate: format(endDate, 'yyyy-MM-dd'),
      frequency: templateConfig.frequency || '',
      themes: templateConfig.themes || [],
      style: templateConfig.style || '',
      postingTime: templateConfig.postingTime || '12:00',
      priority: templateConfig.priority || 5
    })
    
    setIsTemplateSelectorOpen(false)
    setCurrentStep('configure')
    setIsFormPrefilledFromTemplate(true)
    setUsedTemplateName(template.name)
    toast.success(`Campaign form pre-filled with "${template.name}" template settings!`)
  }

  const handleDeleteCampaign = (campaignId: string, campaignName: string) => {
    if (confirm(`Are you sure you want to delete the campaign "${campaignName}"? This action cannot be undone.`)) {
      deleteCampaignMutation.mutate(campaignId)
    }
  }

  const handleViewCampaign = (campaignId: string, campaign: any) => {
    // Only allow viewing if campaign is ready
    if (campaign.status === 'creating' || campaign.status === 'processing') {
      toast.warning('Campaign is still being generated. Please wait for it to complete.')
      return
    }
    
    if (campaign.status === 'failed') {
      toast.error('Campaign generation failed. Please delete and recreate the campaign.')
      return
    }

    setSelectedCampaignId(campaignId)
    setCurrentStep('details')
  }

  const handleStartCampaign = () => {
    if (campaignPreview) {
      startCampaignMutation.mutate(campaignPreview.campaignId)
    }
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

  const handleEditCampaign = (campaign: any) => {
    const config = campaign.config
    if (!config || !config.duration) {
      toast.error('Campaign configuration not available. Please try refreshing the page.')
      return
    }
    
    setEditFormData({
      name: campaign.name,
      startDate: config.duration.start.split('T')[0], // Extract just the date part (YYYY-MM-DD)
      endDate: config.duration.end.split('T')[0], // Extract just the date part (YYYY-MM-DD)
      frequency: config.frequency,
      themes: config.themes || [],
      style: config.style,
      postingTime: config.postingTime,
      priority: campaign.priority || 5
    })
    setIsEditingCampaign(true)
  }

  const handleSaveEdit = async () => {
    if (!selectedCampaignId || !validateEditForm()) {
      return
    }

    const updates = {
      name: editFormData.name,
      themes: editFormData.themes,
      style: editFormData.style,
      frequency: editFormData.frequency,
      postingTime: editFormData.postingTime,
      startDate: editFormData.startDate,
      endDate: editFormData.endDate
    }

    updateCampaignMutation.mutate({ campaignId: selectedCampaignId, updates })
  }

  const handleCancelEdit = () => {
    setIsEditingCampaign(false)
    setEditFormData(initialFormData)
    setErrors({})
  }

  const validateEditForm = (): boolean => {
    const newErrors: CampaignErrors = {}

    if (!editFormData.name.trim()) {
      newErrors.name = 'Campaign name is required'
    }

    if (!editFormData.startDate) {
      newErrors.startDate = 'Start date is required'
    }

    if (!editFormData.endDate) {
      newErrors.endDate = 'End date is required'
    }

    if (editFormData.startDate && editFormData.endDate) {
      const startDate = new Date(editFormData.startDate)
      const endDate = new Date(editFormData.endDate)
      if (endDate <= startDate) {
        newErrors.endDate = 'End date must be after start date'
      }
    }

    if (!editFormData.frequency) {
      newErrors.frequency = 'Posting frequency is required'
    }

    if (editFormData.themes.length === 0) {
      newErrors.themes = ['At least one theme is required']
    }

    if (!editFormData.style) {
      newErrors.style = 'Style selection is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleEditInputChange = (field: keyof CampaignFormData, value: string | number) => {
    setEditFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }

  const addEditTheme = (theme: string) => {
    if (theme && !editFormData.themes.includes(theme)) {
      const updatedThemes = [...editFormData.themes, theme]
      setEditFormData(prev => ({ ...prev, themes: updatedThemes }))
      if (errors.themes) {
        setErrors(prev => ({ ...prev, themes: undefined }))
      }
    }
  }

  const removeEditTheme = (themeToRemove: string) => {
    const updatedThemes = editFormData.themes.filter(theme => theme !== themeToRemove)
    setEditFormData(prev => ({ ...prev, themes: updatedThemes }))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Autopilot Mode</h1>
        <p className="text-gray-600 mt-1">
          {currentStep === 'list' 
            ? `Manage automated content campaigns for ${selectedBrand.name}`
            : currentStep === 'configure' 
            ? `Configure automated content generation and posting campaigns for ${selectedBrand.name}`
            : currentStep === 'details'
            ? `View campaign details and content for ${selectedBrand.name}`
            : `Review your campaign preview for ${selectedBrand.name}`
          }
        </p>
      </div>

      {currentStep === 'list' && (
        <>
          {/* Campaign List Header */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Campaign Management</CardTitle>
                  <CardDescription>
                    View and manage your automated content campaigns
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => setIsComparisonOpen(true)}
                    disabled={!campaignsQuery.data?.campaigns?.length || campaignsQuery.data.campaigns.filter(c => ['active', 'completed', 'paused'].includes(c.status)).length < 2}
                    className="flex items-center gap-2"
                  >
                    <BarChart3 className="w-4 h-4" />
                    Compare Campaigns
                  </Button>
                  <Button variant="outline" onClick={handleUseTemplate} className="flex items-center gap-2 bg-blue-50 border-blue-200 hover:bg-blue-100">
                    <FileText className="w-4 h-4 text-blue-600" />
                    Use FileText
                  </Button>
                  <Button onClick={handleCreateNewCampaign} className="flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    Create New Campaign
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Campaign List */}
          <Card>
            <CardHeader>
              <CardTitle>Your Campaigns</CardTitle>
              <CardDescription>
                {campaignsQuery.data?.campaigns?.length || 0} campaign(s) found
              </CardDescription>
            </CardHeader>
            <CardContent>
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
              ) : !campaignsQuery.data?.campaigns?.length ? (
                <div className="text-center py-8">
                  <div className="mb-4">
                    <List className="w-12 h-12 mx-auto text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No campaigns yet</h3>
                  <p className="text-gray-600 mb-4">
                    Create your first automated content campaign to get started.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button variant="outline" onClick={handleUseTemplate} className="flex items-center gap-2 bg-blue-50 border-blue-200 hover:bg-blue-100">
                      <FileText className="w-4 h-4 text-blue-600" />
                      Use FileText
                    </Button>
                    <Button onClick={handleCreateNewCampaign} className="flex items-center gap-2">
                      <Plus className="w-4 h-4" />
                      Create New Campaign
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {campaignsQuery.data.campaigns.map((campaign: any) => (
                    <Card key={campaign.id} variant={getCampaignCardVariant(campaign.status)}>
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-semibold text-lg">{campaign.name}</h3>
                              <Badge 
                                variant={
                                  campaign.status === 'active' ? 'default' :
                                  campaign.status === 'preview' ? 'default' :
                                  campaign.status === 'creating' || campaign.status === 'processing' ? 'secondary' :
                                  campaign.status === 'failed' ? 'destructive' :
                                  campaign.status === 'paused' ? 'outline' :
                                  'secondary'
                                }
                              >
                                {campaign.status === 'creating' ? 'generating...' :
                                 campaign.status === 'preview' ? 'ready to launch' :
                                 campaign.status === 'processing' ? 'processing...' :
                                 campaign.status}
                              </Badge>
                              {campaign.priority && (
                                <Badge variant="outline" className="text-xs">
                                  {campaign.priority === 1 ? '🔴 Urgent' :
                                   campaign.priority === 2 ? '🟠 High' :
                                   campaign.priority === 3 ? '🟡 Med-High' :
                                   campaign.priority === 4 ? '🟢 Medium' :
                                   campaign.priority === 5 ? '🔵 Normal' :
                                   campaign.priority === 6 ? '⚪ Low' :
                                   campaign.priority === 7 ? '⚫ Very Low' :
                                   `Priority ${campaign.priority}`}
                                </Badge>
                              )}
                              {(campaign.status === 'creating' || campaign.status === 'processing') && (
                                <div className="flex items-center gap-2">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  <span className="text-sm text-gray-600">
                                    {campaign.progress || 0}%
                                  </span>
                                </div>
                              )}
                            </div>
                            
                            {/* Progress bar for creating campaigns */}
                            {(campaign.status === 'creating' || campaign.status === 'processing') && (
                              <div className="mb-3">
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                  <div 
                                    className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                                    style={{ width: `${campaign.progress || 0}%` }}
                                  ></div>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                  Generating preview content...
                                </p>
                              </div>
                            )}
                            
                            {/* Error message for failed campaigns */}
                            {campaign.status === 'failed' && campaign.errorMessage && (
                              <div className="mb-3">
                                <p className="text-sm text-red-600">
                                  Error: {campaign.errorMessage}
                                </p>
                              </div>
                            )}
                            
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600 mb-4">
                              <div>
                                <span className="font-medium">Brand:</span> {campaign.brand.name}
                              </div>
                              <div>
                                <span className="font-medium">Content:</span> {campaign.contentCount} posts
                              </div>
                              <div>
                                <span className="font-medium">Priority:</span> {campaign.priority || 5}
                              </div>
                              <div>
                                <span className="font-medium">Created:</span> {format(new Date(campaign.createdAt), 'MMM d, yyyy')}
                              </div>
                              {campaign.startedAt && (
                                <div>
                                  <span className="font-medium">Started:</span> {format(new Date(campaign.startedAt), 'MMM d, yyyy')}
                                </div>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 ml-4">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleViewCampaign(campaign.id, campaign)}
                              className="flex items-center gap-1"
                              disabled={campaign.status === 'creating' || campaign.status === 'processing'}
                            >
                              <Eye className="w-3 h-3" />
                              View
                            </Button>
                            
                            {campaign.status === 'preview' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedCampaignId(campaign.id)
                                  handleEditCampaign(campaign)
                                }}
                                className="flex items-center gap-1"
                              >
                                <Edit className="w-3 h-3" />
                                Edit
                              </Button>
                            )}
                            
                            {(campaign.status === 'preview' || campaign.status === 'failed' || campaign.status === 'creating') && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteCampaign(campaign.id, campaign.name)}
                                disabled={deleteCampaignMutation.isPending}
                                className="flex items-center gap-1 text-red-600 hover:text-red-700"
                              >
                                {deleteCampaignMutation.isPending ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3 h-3" />
                                )}
                                Delete
                              </Button>
                            )}
                            
                            {campaign.status === 'active' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toast.info('Campaign pause/resume coming soon!')}
                                className="flex items-center gap-1"
                              >
                                <Pause className="w-3 h-3" />
                                Pause
                              </Button>
                            )}
                            
                            {campaign.status === 'paused' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toast.info('Campaign pause/resume coming soon!')}
                                className="flex items-center gap-1"
                              >
                                <Play className="w-3 h-3" />
                                Resume
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {currentStep === 'configure' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Campaign Configuration</CardTitle>
                <CardDescription>
                  Set up your automated content generation and posting campaign
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleBackToList}>
                  ← Back to Campaigns
                </Button>
                <Button variant="outline" onClick={handleUseTemplateForConfig} className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Use FileText Instead
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* FileText Pre-fill Indicator */}
            {isFormPrefilledFromTemplate && usedTemplateName && (
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <div>
                    <p className="font-medium text-blue-900">Form pre-filled from template</p>
                    <p className="text-sm text-blue-700">
                      Using settings from "{usedTemplateName}" template. You can modify any field before creating your campaign.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
          {/* Campaign Name */}
          <div className="space-y-2">
            <Label htmlFor="campaign-name">Campaign Name</Label>
            <Input
              id="campaign-name"
              type="text"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              placeholder="Enter campaign name..."
              className={errors.name ? 'border-red-500' : ''}
            />
            {errors.name && (
              <p className="text-sm text-red-600">{errors.name}</p>
            )}
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={formData.startDate}
                onChange={(e) => handleInputChange('startDate', e.target.value)}
                min={getTodayDate()}
                className={errors.startDate ? 'border-red-500' : ''}
              />
              {errors.startDate && (
                <p className="text-sm text-red-600">{errors.startDate}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={formData.endDate}
                onChange={(e) => handleInputChange('endDate', e.target.value)}
                min={formData.startDate || getTodayDate()}
                className={errors.endDate ? 'border-red-500' : ''}
              />
              {errors.endDate && (
                <p className="text-sm text-red-600">{errors.endDate}</p>
              )}
            </div>
          </div>

          {/* Posting Frequency */}
          <div className="space-y-2">
            <Label htmlFor="frequency">Posting Frequency</Label>
            <Select value={formData.frequency} onValueChange={(value) => handleInputChange('frequency', value)}>
              <SelectTrigger className={errors.frequency ? 'border-red-500' : ''}>
                <SelectValue placeholder="Select posting frequency" />
              </SelectTrigger>
              <SelectContent>
                {frequencyOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.frequency && (
              <p className="text-sm text-red-600">{errors.frequency}</p>
            )}
          </div>

          {/* Content Themes */}
          <div className="space-y-3">
            <Label>Content Themes</Label>
            
            {/* Common themes */}
            <div>
              <p className="text-sm text-gray-600 mb-2">Select from common themes:</p>
              <div className="flex flex-wrap gap-2">
                {commonThemes.map(theme => (
                  <Badge
                    key={theme}
                    variant={formData.themes.includes(theme) ? "default" : "secondary"}
                    className="cursor-pointer hover:bg-primary/80"
                    onClick={() => addTheme(theme)}
                  >
                    {theme}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Custom theme input */}
            <div>
              <p className="text-sm text-gray-600 mb-2">Or add custom theme:</p>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={newTheme}
                  onChange={(e) => setNewTheme(e.target.value)}
                  placeholder="Enter custom theme..."
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCustomTheme())}
                />
                <Button type="button" onClick={handleAddCustomTheme} variant="outline">
                  Add
                </Button>
              </div>
            </div>

            {/* Selected themes */}
            {formData.themes.length > 0 && (
              <div>
                <p className="text-sm text-gray-600 mb-2">Selected themes:</p>
                <div className="flex flex-wrap gap-2">
                  {formData.themes.map(theme => (
                    <Badge
                      key={theme}
                      variant="default"
                      className="cursor-pointer group"
                    >
                      {theme}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTheme(theme)}
                        className="ml-1 h-auto p-0 text-current hover:bg-transparent"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {errors.themes && (
              <p className="text-sm text-red-600">{errors.themes[0]}</p>
            )}
          </div>

          {/* Style Selection */}
          <div className="space-y-2">
            <Label htmlFor="style">Content Style</Label>
            <Select value={formData.style} onValueChange={(value) => handleInputChange('style', value)}>
              <SelectTrigger className={errors.style ? 'border-red-500' : ''}>
                <SelectValue placeholder="Select content style" />
              </SelectTrigger>
              <SelectContent>
                {styleOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.style && (
              <p className="text-sm text-red-600">{errors.style}</p>
            )}
          </div>

          {/* Posting Time */}
          <div className="space-y-2">
            <Label htmlFor="posting-time">Preferred Posting Time</Label>
            <Input
              id="posting-time"
              type="time"
              value={formData.postingTime}
              onChange={(e) => handleInputChange('postingTime', e.target.value)}
            />
            <p className="text-sm text-gray-500">
              Content will be scheduled to post at this time each day
            </p>
          </div>

          {/* Campaign Priority */}
          <div className="space-y-2">
            <Label htmlFor="priority">Campaign Priority</Label>
            <Select value={formData.priority?.toString() || '5'} onValueChange={(value) => handleInputChange('priority', parseInt(value))}>
              <SelectTrigger>
                <SelectValue placeholder="Select priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">🔴 Urgent (1)</SelectItem>
                <SelectItem value="2">🟠 High (2)</SelectItem>
                <SelectItem value="3">🟡 Medium-High (3)</SelectItem>
                <SelectItem value="4">🟢 Medium (4)</SelectItem>
                <SelectItem value="5">🔵 Normal (5)</SelectItem>
                <SelectItem value="6">⚪ Low (6)</SelectItem>
                <SelectItem value="7">⚫ Very Low (7)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-gray-500">
              Higher priority campaigns get preferred scheduling slots when conflicts arise
            </p>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end pt-4">
            <Button
              type="submit"
              disabled={configureMutation.isPending}
              className="min-w-[160px]"
            >
              {configureMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating Campaign...
                </>
              ) : (
                'Create Campaign'
              )}
            </Button>
          </div>
            </form>
          </CardContent>
        </Card>
      )}

      {currentStep === 'preview' && campaignPreview && (
        <>
          {/* Campaign Plan Overview */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Campaign Preview</CardTitle>
                  <CardDescription>Review your campaign plan and example content</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleBackToList}>
                    ← Back to Campaigns
                  </Button>
                  <Button variant="outline" onClick={handleBackToConfiguration}>
                    Back to Configuration
                  </Button>
                </div>
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
                        (new Date(campaignPreview.campaignPlan.duration.end).getTime() - 
                         new Date(campaignPreview.campaignPlan.duration.start).getTime()) 
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
                    <p className="text-sm text-muted-foreground">Total Posts</p>
                    <p className="font-semibold">
                      {campaignPreview.campaignPlan.estimatedTotalPosts}
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
                      {getFrequencyLabel(campaignPreview.campaignPlan.postingSchedule)}
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
                      {getStyleLabel(campaignPreview.campaignPlan.style)}
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
                    <span className="text-muted-foreground">Name:</span>
                    <span className="font-medium">{campaignPreview.campaignPlan.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Start Date:</span>
                    <span className="font-medium">
                      {format(new Date(campaignPreview.campaignPlan.duration.start), 'MMM d, yyyy')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">End Date:</span>
                    <span className="font-medium">
                      {format(new Date(campaignPreview.campaignPlan.duration.end), 'MMM d, yyyy')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Posting Time:</span>
                    <span className="font-medium">{campaignPreview.campaignPlan.postingTime}</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-medium mb-2">Content Themes</h3>
                <div className="flex flex-wrap gap-2">
                  {campaignPreview.campaignPlan.themes.map((theme, index) => (
                    <Badge key={index} variant="secondary">
                      {theme}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            </CardContent>
          </Card>

          {/* Example Posts Preview */}
          <Card>
            <CardHeader>
              <CardTitle>Example Posts Preview</CardTitle>
              <CardDescription>
                Here are 3 sample posts that will be generated as part of your campaign. You can edit or regenerate any post.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {campaignPreview.examplePosts.map((post, index) => (
                    <Card key={post.id}>
                      {post.imageUrl && (
                        <div className="aspect-w-16 aspect-h-9">
                          <img
                            src={post.imageUrl}
                            alt={`Example post ${index + 1}`}
                            className="w-full h-48 object-cover rounded-t-lg"
                          />
                        </div>
                      )}
                      
                      <CardContent className="p-4">
                        <div className="mb-3">
                          <p className="text-sm leading-relaxed overflow-hidden" style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical'
                          }}>
                            {post.caption}
                          </p>
                        </div>

                        <div className="mb-4">
                          <div className="flex flex-wrap gap-1">
                            {post.hashtags.slice(0, 3).map((tag, tagIndex) => (
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

                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditPost(post)}
                            className="w-full"
                          >
                            <Edit className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Start Campaign Button */}
          <Card>
            <CardContent className="flex items-center justify-between p-6">
              <div>
                <CardTitle className="text-lg">Ready to Launch?</CardTitle>
                <CardDescription className="mt-1">
                  Your campaign is configured and ready to start generating content automatically.
                </CardDescription>
              </div>
              <Button
                onClick={handleStartCampaign}
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
        </>
      )}

      {currentStep === 'details' && campaignDetailsQuery.data?.campaign && (
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
                  <Button variant="outline" onClick={handleBackToList}>
                    ← Back to Campaigns
                  </Button>
                  <div className="flex gap-2">
                    {campaignDetailsQuery.data.campaign.status === 'preview' && (
                      <Button 
                        variant="outline" 
                        onClick={() => handleEditCampaign(campaignDetailsQuery.data.campaign)}
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
                      Save as FileText
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
                        {campaign.content.map((post: any) => (
                          <Card key={post.id}>
                            {post.imageUrl && (
                              <div className="aspect-w-16 aspect-h-9">
                                <img
                                  src={post.imageUrl}
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
                                      post.status === 'posted' ? 'default' :
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

      {/* Campaign Edit Modal */}
      {isEditingCampaign && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto m-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Edit Campaign</h2>
                <Button variant="ghost" onClick={handleCancelEdit}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-6">
                {/* Campaign Name */}
                <div className="space-y-2">
                  <Label htmlFor="edit-campaign-name">Campaign Name</Label>
                  <Input
                    id="edit-campaign-name"
                    type="text"
                    value={editFormData.name}
                    onChange={(e) => handleEditInputChange('name', e.target.value)}
                    placeholder="Enter campaign name..."
                    className={errors.name ? 'border-red-500' : ''}
                  />
                  {errors.name && (
                    <p className="text-sm text-red-600">{errors.name}</p>
                  )}
                </div>

                {/* Date Range */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-start-date">Start Date</Label>
                    <Input
                      id="edit-start-date"
                      type="date"
                      value={editFormData.startDate}
                      onChange={(e) => handleEditInputChange('startDate', e.target.value)}
                      min={getTodayDate()}
                      className={errors.startDate ? 'border-red-500' : ''}
                    />
                    {errors.startDate && (
                      <p className="text-sm text-red-600">{errors.startDate}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-end-date">End Date</Label>
                    <Input
                      id="edit-end-date"
                      type="date"
                      value={editFormData.endDate}
                      onChange={(e) => handleEditInputChange('endDate', e.target.value)}
                      min={editFormData.startDate || getTodayDate()}
                      className={errors.endDate ? 'border-red-500' : ''}
                    />
                    {errors.endDate && (
                      <p className="text-sm text-red-600">{errors.endDate}</p>
                    )}
                  </div>
                </div>

                {/* Posting Frequency */}
                <div className="space-y-2">
                  <Label htmlFor="edit-frequency">Posting Frequency</Label>
                  <Select value={editFormData.frequency} onValueChange={(value) => handleEditInputChange('frequency', value)}>
                    <SelectTrigger className={errors.frequency ? 'border-red-500' : ''}>
                      <SelectValue placeholder="Select posting frequency" />
                    </SelectTrigger>
                    <SelectContent>
                      {frequencyOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.frequency && (
                    <p className="text-sm text-red-600">{errors.frequency}</p>
                  )}
                </div>

                {/* Content Themes */}
                <div className="space-y-3">
                  <Label>Content Themes</Label>
                  
                  {/* Common themes */}
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Select from common themes:</p>
                    <div className="flex flex-wrap gap-2">
                      {commonThemes.map(theme => (
                        <Badge
                          key={theme}
                          variant={editFormData.themes.includes(theme) ? "default" : "secondary"}
                          className="cursor-pointer hover:bg-primary/80"
                          onClick={() => addEditTheme(theme)}
                        >
                          {theme}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Custom theme input */}
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Or add custom theme:</p>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        value={newTheme}
                        onChange={(e) => setNewTheme(e.target.value)}
                        placeholder="Enter custom theme..."
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addEditTheme(newTheme.trim()), setNewTheme(''))}
                      />
                      <Button type="button" onClick={() => { addEditTheme(newTheme.trim()); setNewTheme('') }} variant="outline">
                        Add
                      </Button>
                    </div>
                  </div>

                  {/* Selected themes */}
                  {editFormData.themes.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-600 mb-2">Selected themes:</p>
                      <div className="flex flex-wrap gap-2">
                        {editFormData.themes.map(theme => (
                          <Badge
                            key={theme}
                            variant="default"
                            className="cursor-pointer group"
                          >
                            {theme}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeEditTheme(theme)}
                              className="ml-1 h-auto p-0 text-current hover:bg-transparent"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {errors.themes && (
                    <p className="text-sm text-red-600">{errors.themes[0]}</p>
                  )}
                </div>

                {/* Style Selection */}
                <div className="space-y-2">
                  <Label htmlFor="edit-style">Content Style</Label>
                  <Select value={editFormData.style} onValueChange={(value) => handleEditInputChange('style', value)}>
                    <SelectTrigger className={errors.style ? 'border-red-500' : ''}>
                      <SelectValue placeholder="Select content style" />
                    </SelectTrigger>
                    <SelectContent>
                      {styleOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.style && (
                    <p className="text-sm text-red-600">{errors.style}</p>
                  )}
                </div>

                {/* Posting Time */}
                <div className="space-y-2">
                  <Label htmlFor="edit-posting-time">Preferred Posting Time</Label>
                  <Input
                    id="edit-posting-time"
                    type="time"
                    value={editFormData.postingTime}
                    onChange={(e) => handleEditInputChange('postingTime', e.target.value)}
                  />
                  <p className="text-sm text-gray-500">
                    Content will be scheduled to post at this time each day
                  </p>
                </div>

                {/* Campaign Priority */}
                <div className="space-y-2">
                  <Label htmlFor="edit-priority">Campaign Priority</Label>
                  <Select value={editFormData.priority?.toString() || '5'} onValueChange={(value) => handleEditInputChange('priority', parseInt(value))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">🔴 Urgent (1)</SelectItem>
                      <SelectItem value="2">🟠 High (2)</SelectItem>
                      <SelectItem value="3">🟡 Medium-High (3)</SelectItem>
                      <SelectItem value="4">🟢 Medium (4)</SelectItem>
                      <SelectItem value="5">🔵 Normal (5)</SelectItem>
                      <SelectItem value="6">⚪ Low (6)</SelectItem>
                      <SelectItem value="7">⚫ Very Low (7)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-gray-500">
                    Higher priority campaigns get preferred scheduling slots when conflicts arise
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 pt-4">
                  <Button variant="outline" onClick={handleCancelEdit}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveEdit}
                    disabled={updateCampaignMutation.isPending}
                    className="min-w-[120px]"
                  >
                    {updateCampaignMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {campaignDetailsQuery.isLoading && currentStep === 'details' && (
        <Card>
          <CardContent className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading campaign details...
          </CardContent>
        </Card>
      )}

      {campaignDetailsQuery.error && currentStep === 'details' && (
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
          onTemplateForConfiguration={handleTemplateForConfiguration}
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
        campaigns={campaignsQuery.data?.campaigns || []}
        isOpen={isComparisonOpen}
        onClose={() => setIsComparisonOpen(false)}
      />
    </div>
  )
}