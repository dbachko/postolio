import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { Switch } from './ui/switch'
import { Card, CardContent } from './ui/card'
import { Check, Save } from 'lucide-react'

interface SaveAsTemplateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  campaignId: string
  onTemplateSaved?: (templateId: string) => void
}

export function SaveAsTemplateModal({
  open,
  onOpenChange,
  campaignId,
  onTemplateSaved
}: SaveAsTemplateModalProps) {
  const [templateName, setTemplateName] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const queryClient = useQueryClient()

  // Fetch campaign details
  const { data: campaignData, isLoading: campaignLoading } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => apiClient.getCampaign(campaignId),
    enabled: !!campaignId && open,
  })

  const campaign = campaignData?.campaign

  // Pre-fill form when campaign data loads
  useEffect(() => {
    if (campaign && open) {
      setTemplateName(campaign.name ? `${campaign.name} Template` : '')
      setDescription(`Template based on the "${campaign.name}" campaign`)
    }
  }, [campaign, open])

  const createTemplateMutation = useMutation({
    mutationFn: (data: {
      name: string
      description?: string
      isPublic: boolean
      brandId?: string
    }) => apiClient.saveCampaignAsTemplate(campaignId, data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      onTemplateSaved?.(response.template.id)
      handleClose()
    }
  })


  const handleSubmit = () => {
    if (!templateName.trim()) return

    createTemplateMutation.mutate({
      name: templateName.trim(),
      description: description.trim() || undefined,
      isPublic,
      brandId: campaign?.brandId
    })
  }

  const handleClose = () => {
    setTemplateName('')
    setDescription('')
    setIsPublic(false)
    onOpenChange(false)
  }

  const isValid = templateName.trim()

  if (campaignLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="w-5 h-5" />
            Save as Template
          </DialogTitle>
          <DialogDescription>
            Save this campaign configuration as a reusable template for future campaigns.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Campaign Preview */}
          {campaign && (
            <Card className="bg-gray-50">
              <CardContent className="p-4">
                <h4 className="font-medium mb-2">Campaign: {campaign.name}</h4>
                <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                  <div>Frequency: {campaign.config?.frequency || 'Not set'}</div>
                  <div>Style: {campaign.config?.style || 'Not set'}</div>
                  <div>Themes: {campaign.config?.themes?.join(', ') || 'None'}</div>
                  <div>Content Count: {campaign.contentCount || 0}</div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Template Name */}
          <div className="space-y-2">
            <Label htmlFor="template-name">Template Name *</Label>
            <Input
              id="template-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Enter template name..."
              className={!templateName.trim() ? 'border-red-300' : ''}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this template is best used for..."
              className="min-h-[80px]"
            />
          </div>


          {/* Public/Private */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <Label htmlFor="public-template" className="font-medium">
                Make template public
              </Label>
              <p className="text-sm text-gray-600 mt-1">
                Public templates can be used by other users in the community
              </p>
            </div>
            <Switch
              id="public-template"
              checked={isPublic}
              onCheckedChange={setIsPublic}
            />
          </div>

          {/* What will be saved */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4">
              <h4 className="font-medium text-blue-900 mb-2">What will be saved in this template:</h4>
              <div className="space-y-1 text-sm text-blue-800">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  <span>Campaign configuration (frequency, style, themes, posting time)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  <span>Duration settings as a template baseline</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  <span>Example content from this campaign (up to 5 posts)</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={!isValid || createTemplateMutation.isPending}
          >
            {createTemplateMutation.isPending ? 'Saving...' : 'Save Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}