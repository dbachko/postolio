import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiClient, type CampaignTemplate } from '../lib/api'
import { TemplateLibrary } from './TemplateLibrary'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Badge } from './ui/badge'
import { Calendar, Clock, ArrowRight, X } from 'lucide-react'

interface TemplateSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  brandId: string
  onTemplateSelected?: (campaignId: string) => void
  onTemplateForConfiguration?: (template: CampaignTemplate) => void
  mode?: 'create' | 'configure'
}

export function TemplateSelector({
  open,
  onOpenChange,
  brandId,
  onTemplateSelected,
  onTemplateForConfiguration,
  mode = 'create'
}: TemplateSelectorProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<CampaignTemplate | null>(null)
  const [step, setStep] = useState<'select' | 'confirm'>('select')

  const useTemplateMutation = useMutation({
    mutationFn: (templateId: string) => apiClient.useTemplate(templateId, {
      name: `${selectedTemplate?.name} Campaign`,
      brandId,
      duration: {
        start: new Date(),
        end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      }
    }),
    onSuccess: (response) => {
      onTemplateSelected?.(response.campaign.id)
      handleClose()
    }
  })

  const handleTemplateSelect = (template: CampaignTemplate) => {
    setSelectedTemplate(template)
    setStep('confirm')
  }

  const handleConfirmUse = () => {
    if (selectedTemplate) {
      if (mode === 'configure' && onTemplateForConfiguration) {
        onTemplateForConfiguration(selectedTemplate)
        handleClose()
      } else {
        useTemplateMutation.mutate(selectedTemplate.id)
      }
    }
  }

  const handleBack = () => {
    setStep('select')
    setSelectedTemplate(null)
  }

  const handleClose = () => {
    setStep('select')
    setSelectedTemplate(null)
    onOpenChange(false)
  }

  const getDurationText = (template: CampaignTemplate) => {
    if (!template.config?.duration?.start || !template.config?.duration?.end) {
      return 'Not set'
    }
    const start = new Date(template.config.duration.start)
    const end = new Date(template.config.duration.end)
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    return `${days} days`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 'confirm' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="mr-2"
              >
                ← Back
              </Button>
            )}
            {step === 'select' ? 'Select Campaign Template' : 'Confirm Template Selection'}
          </DialogTitle>
          <DialogDescription>
            {step === 'select' 
              ? 'Choose a template to quickly set up your campaign with predefined settings and content themes.'
              : mode === 'configure' 
              ? 'Review the template details and confirm to use it for campaign configuration.'
              : 'Review the template details and confirm to create your campaign.'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {step === 'select' ? (
            <TemplateLibrary
              onSelectTemplate={handleTemplateSelect}
              showCreateButton={false}
              selectionMode={true}
            />
          ) : selectedTemplate && (
            <div className="space-y-6">
              {/* Template Overview */}
              <Card>
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-xl font-semibold mb-2">{selectedTemplate.name}</h3>
                        <Badge variant="outline" className="mb-3">{selectedTemplate.category}</Badge>
                        {selectedTemplate.description && (
                          <p className="text-gray-600">{selectedTemplate.description}</p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleBack}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Calendar className="w-4 h-4" />
                        <span>Duration: {getDurationText(selectedTemplate)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Clock className="w-4 h-4" />
                        <span>Frequency: {selectedTemplate.config?.frequency || 'Not set'}</span>
                      </div>
                      <div className="text-sm text-gray-600">
                        Posting Time: {selectedTemplate.config?.postingTime || 'Not set'}
                      </div>
                      <div className="text-sm text-gray-600">
                        {selectedTemplate.usageCount} previous uses
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Campaign Configuration Preview */}
              <Card>
                <CardContent className="p-6">
                  <h4 className="font-semibold mb-4">Campaign Configuration</h4>
                  <div className="space-y-4">
                    <div>
                      <h5 className="font-medium text-sm text-gray-700 mb-2">Content Themes</h5>
                      <div className="flex flex-wrap gap-2">
                        {(selectedTemplate.config?.themes || []).map(theme => (
                          <Badge key={theme} variant="secondary">{theme}</Badge>
                        ))}
                      </div>
                    </div>
                    
                    <div>
                      <h5 className="font-medium text-sm text-gray-700 mb-2">Content Style</h5>
                      <Badge variant="outline">{selectedTemplate.config?.style || 'Not set'}</Badge>
                    </div>

                    {(selectedTemplate.tags || []).length > 0 && (
                      <div>
                        <h5 className="font-medium text-sm text-gray-700 mb-2">Template Tags</h5>
                        <div className="flex flex-wrap gap-2">
                          {(selectedTemplate.tags || []).map(tag => (
                            <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Example Content Preview */}
              {(selectedTemplate.exampleContent || []).length > 0 && (
                <Card>
                  <CardContent className="p-6">
                    <h4 className="font-semibold mb-4">Example Content ({(selectedTemplate.exampleContent || []).length} samples)</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {(selectedTemplate.exampleContent || []).slice(0, 3).map(content => (
                        <div key={content.id} className="border rounded-lg p-4 bg-gray-50">
                          {content.imageUrl && (
                            <div className="w-full h-32 bg-gray-200 rounded mb-3 flex items-center justify-center">
                              <img 
                                src={content.imageUrl} 
                                alt="Content preview"
                                className="w-full h-full object-cover rounded"
                              />
                            </div>
                          )}
                          <p className="text-sm text-gray-700 line-clamp-3 mb-2">
                            {content.caption}
                          </p>
                          {content.hashtags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {content.hashtags.slice(0, 3).map(tag => (
                                <span key={tag} className="text-xs text-blue-600">
                                  #{tag}
                                </span>
                              ))}
                              {content.hashtags.length > 3 && (
                                <span className="text-xs text-gray-500">
                                  +{content.hashtags.length - 3} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {(selectedTemplate.exampleContent || []).length > 3 && (
                      <p className="text-sm text-gray-500 mt-3">
                        And {(selectedTemplate.exampleContent || []).length - 3} more example posts...
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* What happens next */}
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-6">
                  <h4 className="font-semibold mb-3 text-blue-900">What happens next?</h4>
                  <div className="space-y-2 text-sm text-blue-800">
                    {mode === 'configure' ? (
                      <>
                        <div className="flex items-center gap-2">
                          <ArrowRight className="w-4 h-4" />
                          <span>The campaign configuration form will be pre-filled with this template's settings</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ArrowRight className="w-4 h-4" />
                          <span>You can customize any settings before creating the campaign</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ArrowRight className="w-4 h-4" />
                          <span>AI will generate content based on your final configuration</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <ArrowRight className="w-4 h-4" />
                          <span>A new campaign will be created with this template's configuration</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ArrowRight className="w-4 h-4" />
                          <span>You can customize the settings before launching</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ArrowRight className="w-4 h-4" />
                          <span>AI will generate content based on the template's themes and style</span>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {step === 'confirm' && (
          <DialogFooter>
            <Button variant="outline" onClick={handleBack}>
              Back to Templates
            </Button>
            <Button 
              onClick={handleConfirmUse}
              disabled={useTemplateMutation.isPending}
            >
              {useTemplateMutation.isPending ? 'Creating Campaign...' : 
               mode === 'configure' ? 'Use for Configuration' : 'Use This Template'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}