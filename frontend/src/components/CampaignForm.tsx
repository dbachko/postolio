import { useState, memo } from 'react'
import { format } from 'date-fns'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Loader2, X, FileText } from 'lucide-react'
import type { CampaignFormData, CampaignErrors } from '../types/campaign'
import { frequencyOptions, styleOptions, commonThemes } from '../constants/campaign'


interface CampaignFormProps {
  formData: CampaignFormData
  errors: CampaignErrors
  isSubmitting: boolean
  isFormPrefilledFromTemplate?: boolean
  usedTemplateName?: string | null
  mode?: 'create' | 'edit'
  existingCampaign?: any
  onSubmit: (e: React.FormEvent) => void
  onInputChange: (field: keyof CampaignFormData, value: string | number) => void
  onAddTheme: (theme: string) => void
  onRemoveTheme: (theme: string) => void
  onBackToDashboard: () => void
  onUseTemplate?: () => void
  onCancel?: () => void
}


const CampaignForm = memo(({
  formData,
  errors,
  isSubmitting,
  isFormPrefilledFromTemplate = false,
  usedTemplateName = null,
  mode = 'create',
  existingCampaign,
  onSubmit,
  onInputChange,
  onAddTheme,
  onRemoveTheme,
  onBackToDashboard,
  onUseTemplate,
  onCancel
}: CampaignFormProps) => {
  const [newTheme, setNewTheme] = useState('')

  const getTodayDate = () => {
    return format(new Date(), 'yyyy-MM-dd')
  }

  // Check if a field is editable based on campaign status
  const isFieldEditable = (fieldName: string) => {
    if (mode === 'create') return true
    if (!existingCampaign) return true

    const status = existingCampaign.status
    const editableFields = {
      completed: [],
      active: ['name', 'priority'],
      paused: ['name', 'priority'],
      failed: ['name', 'priority', 'themes', 'style', 'frequency', 'dates'],
      creating: ['name', 'priority', 'themes', 'style', 'frequency', 'dates'],
      preview: ['name', 'priority', 'themes', 'style', 'frequency', 'dates'],
      processing: ['name', 'priority']
    }

    return editableFields[status as keyof typeof editableFields]?.includes(fieldName as never) || false
  }

  const handleAddCustomTheme = () => {
    if (newTheme.trim()) {
      onAddTheme(newTheme.trim())
      setNewTheme('')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>
              {mode === 'edit' ? 'Edit Campaign' : 'Create New Campaign'}
            </CardTitle>
            <CardDescription>
              {mode === 'edit' 
                ? 'Modify your campaign settings. Some fields may be restricted based on campaign status.'
                : 'Set up your automated content generation and posting campaign'
              }
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={mode === 'edit' ? onCancel : onBackToDashboard}>
              {mode === 'edit' ? 'Cancel' : '← All Campaigns'}
            </Button>
            {mode === 'create' && onUseTemplate && (
              <Button variant="outline" onClick={onUseTemplate} className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Use Template Instead
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Template Pre-fill Indicator */}
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

        <form onSubmit={onSubmit} className="space-y-6">
          {/* Campaign Name */}
          <div className="space-y-2">
            <Label htmlFor="campaign-name">Campaign Name</Label>
            <Input
              id="campaign-name"
              type="text"
              value={formData.name}
              onChange={(e) => onInputChange('name', e.target.value)}
              placeholder="Enter campaign name..."
              className={errors.name ? 'border-red-500' : ''}
              disabled={!isFieldEditable('name')}
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
                onChange={(e) => onInputChange('startDate', e.target.value)}
                min={getTodayDate()}
                className={errors.startDate ? 'border-red-500' : ''}
                disabled={!isFieldEditable('dates')}
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
                onChange={(e) => onInputChange('endDate', e.target.value)}
                min={formData.startDate || getTodayDate()}
                className={errors.endDate ? 'border-red-500' : ''}
                disabled={!isFieldEditable('dates')}
              />
              {errors.endDate && (
                <p className="text-sm text-red-600">{errors.endDate}</p>
              )}
            </div>
          </div>

          {/* Posting Frequency */}
          <div className="space-y-2">
            <Label htmlFor="frequency">Posting Frequency</Label>
            <Select 
              value={formData.frequency} 
              onValueChange={(value) => onInputChange('frequency', value)}
              disabled={!isFieldEditable('frequency')}
            >
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
                    className={`cursor-pointer hover:bg-primary/80 ${!isFieldEditable('themes') ? 'opacity-50 cursor-not-allowed' : ''}`}
                    onClick={() => isFieldEditable('themes') && onAddTheme(theme)}
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
                  disabled={!isFieldEditable('themes')}
                />
                <Button 
                  type="button" 
                  onClick={handleAddCustomTheme} 
                  variant="outline"
                  disabled={!isFieldEditable('themes')}
                >
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
                      {isFieldEditable('themes') && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onRemoveTheme(theme)}
                          className="ml-1 h-auto p-0 text-current hover:bg-transparent"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
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
            <Select 
              value={formData.style} 
              onValueChange={(value) => onInputChange('style', value)}
              disabled={!isFieldEditable('style')}
            >
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

          {/* Regeneration Indicator for Edit Mode */}
          {mode === 'edit' && existingCampaign?.content?.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <h4 className="text-sm font-medium text-blue-900">Content Regeneration</h4>
              </div>
              <p className="text-sm text-blue-700 mb-2">
                Changes to themes or style will regenerate existing content posts
              </p>
              <div className="flex items-center gap-2 text-xs text-blue-600">
                <span>🔄 Will regenerate {existingCampaign.content.length} posts</span>
                <span>•</span>
                <span>⏱️ Estimated: ~{Math.ceil(existingCampaign.content.length * 7.5)} seconds</span>
              </div>
            </div>
          )}

          {/* Posting Time */}
          <div className="space-y-2">
            <Label htmlFor="posting-time">Preferred Posting Time</Label>
            <Input
              id="posting-time"
              type="time"
              value={formData.postingTime}
              onChange={(e) => onInputChange('postingTime', e.target.value)}
            />
            <p className="text-sm text-gray-500">
              Content will be scheduled to post at this time each day
            </p>
          </div>

          {/* Campaign Priority */}
          <div className="space-y-2">
            <Label htmlFor="priority">Campaign Priority</Label>
            <Select value={formData.priority?.toString() || '5'} onValueChange={(value) => onInputChange('priority', parseInt(value))}>
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
              disabled={isSubmitting}
              className="min-w-[160px]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {mode === 'edit' ? 'Updating Campaign...' : 'Creating Campaign...'}
                </>
              ) : (
                mode === 'edit' ? 'Update Campaign' : 'Create Campaign'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
})

CampaignForm.displayName = 'CampaignForm'

export { CampaignForm }