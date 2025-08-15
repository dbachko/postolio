import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { apiClient, type Content } from '../lib/api'
import { useDebounce } from '../hooks/useDebounce'
import { ImageUploader } from './ImageUploader'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Label } from './ui/label'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Badge } from './ui/badge'
import { Loader2, Save, CheckCircle2, AlertCircle, Brain, Sparkles, X } from 'lucide-react'

interface PostEditorProps {
  content: Content | null
  isOpen: boolean
  onClose: () => void
}

interface FormData {
  caption: string
  hashtags: string[]
  imageUrl: string
  scheduledAt: string
}

export function PostEditor({ content, isOpen, onClose }: PostEditorProps) {
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<FormData>({
    caption: '',
    hashtags: [],
    imageUrl: '',
    scheduledAt: ''
  })
  const [hashtagInput, setHashtagInput] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [learningFeedback, setLearningFeedback] = useState<{
    isVisible: boolean
    message: string
    appliedToFuturePosts?: number
  }>({ isVisible: false, message: '' })

  // Helper function to update content in cache
  const updateContentInCache = (updatedContent: Content) => {
    queryClient.setQueryData(['contentHistory', updatedContent.id], (oldData: { content: Content[] } | undefined) => {
      if (oldData?.content) {
        return {
          ...oldData,
          content: oldData.content.map((item: Content) =>
            item.id === updatedContent.id ? updatedContent : item
          )
        }
      }
      return oldData
    })
  }

  // Initialize form data when content changes
  useEffect(() => {
    if (content && isOpen) {
      setFormData({
        caption: content.caption || '',
        hashtags: content.hashtags || [],
        imageUrl: content.imageUrl || '',
        scheduledAt: content.scheduledAt ? format(new Date(content.scheduledAt), "yyyy-MM-dd'T'HH:mm") : ''
      })
      setHashtagInput((content.hashtags || []).join(' '))
    }
  }, [content, isOpen])

  // Reset form data when modal is closed
  useEffect(() => {
    if (!isOpen) {
      console.log('Modal closed - resetting form data')
      setFormData({
        caption: '',
        hashtags: [],
        imageUrl: '',
        scheduledAt: ''
      })
      setHashtagInput('')
      setLearningFeedback({ isVisible: false, message: '' })
      setSaveStatus('idle')
    }
  }, [isOpen])

  // Additional safety check: Prevent form data corruption
  useEffect(() => {
    if (content && isOpen) {
      // If we somehow have empty form data but valid content, restore it
      if ((!formData.caption || formData.caption.trim() === '') && content.caption && content.caption.trim() !== '') {
        console.warn('CRITICAL: Form data appears corrupted, restoring from content', {
          contentId: content.id,
          contentCaption: content.caption.substring(0, 50) + '...',
          formCaption: formData.caption
        })
        setFormData({
          caption: content.caption || '',
          hashtags: content.hashtags || [],
          imageUrl: content.imageUrl || '',
          scheduledAt: content.scheduledAt ? format(new Date(content.scheduledAt), "yyyy-MM-dd'T'HH:mm") : ''
        })
        setHashtagInput((content.hashtags || []).join(' '))
      }
    }
  }, [content, isOpen, formData.caption])

  // Debounced form data for auto-save
  const debouncedFormData = useDebounce(formData, 500)

  const updateContentMutation = useMutation({
    mutationFn: (data: {
      contentId: string
      caption?: string
      hashtags?: string[]
      imageUrl?: string
      scheduledAt?: string
    }) => {
      // Critical logging before mutation
      console.log('MUTATION CALL:', {
        contentId: data.contentId,
        caption: data.caption,
        captionLength: data.caption?.length || 0,
        hashtags: data.hashtags,
        imageUrl: data.imageUrl,
        scheduledAt: data.scheduledAt,
        scheduledAtType: typeof data.scheduledAt
      })
      
      // Final safety check before API call
      if (!data.caption || data.caption.trim().length === 0) {
        console.error('CRITICAL ERROR: Attempting to call API with empty caption!', data)
        throw new Error('Cannot update content with empty caption')
      }
      
      return apiClient.updateContent(data)
    },
    onMutate: () => {
      setSaveStatus('saving')
    },
    onSuccess: (response) => {
      setSaveStatus('saved')
      setLastSaved(new Date())
      
      // Show learning feedback if AI learned from edits
      if (response.learning?.learningActive) {
        setLearningFeedback({
          isVisible: true,
          message: response.learning.message || 'AI is learning from your edits...',
          appliedToFuturePosts: response.learning.appliedToFuturePosts
        })
        // Note: Notification will persist until user manually closes it
      }
      
      // Update the content in relevant queries
      updateContentInCache(response.content)

      // Invalidate queries to refresh calendar
      queryClient.invalidateQueries({ queryKey: ['contentHistory'] })
      
      // Show "AI is learning" message briefly
      setTimeout(() => {
        setSaveStatus('idle')
      }, 2000)
    },
    onError: (error) => {
      setSaveStatus('error')
      console.error('Failed to update content:', error)
      
      setTimeout(() => {
        setSaveStatus('idle')
      }, 3000)
    }
  })

  // Auto-save when debounced form data changes
  useEffect(() => {
    if (!content || !isOpen) {
      console.log('Skipping autosave: content or modal not available', { contentId: content?.id, isOpen })
      return
    }

    // Critical safety check: NEVER autosave if caption is empty
    if (!debouncedFormData.caption || debouncedFormData.caption.trim().length === 0) {
      console.warn('CRITICAL: Skipping autosave - Caption is empty or undefined', { 
        contentId: content.id, 
        caption: debouncedFormData.caption,
        formDataKeys: Object.keys(debouncedFormData)
      })
      return
    }

    // Additional safety check: ensure we have meaningful form data
    if (debouncedFormData.caption === '' && debouncedFormData.hashtags.length === 0 && debouncedFormData.imageUrl === '') {
      console.log('Skipping autosave: Form data appears to be empty initial state')
      return
    }

    // Check if form data has actually changed from original content
    const originalCaption = content.caption || ''
    const originalHashtags = content.hashtags || []
    const originalImageUrl = content.imageUrl || ''
    const originalScheduledAt = content.scheduledAt ? format(new Date(content.scheduledAt), "yyyy-MM-dd'T'HH:mm") : ''

    const hasChanges = 
      debouncedFormData.caption !== originalCaption ||
      JSON.stringify(debouncedFormData.hashtags) !== JSON.stringify(originalHashtags) ||
      debouncedFormData.imageUrl !== originalImageUrl ||
      debouncedFormData.scheduledAt !== originalScheduledAt

    if (hasChanges) {
      // Final validation before mutation
      if (!debouncedFormData.caption || debouncedFormData.caption.trim().length === 0) {
        console.error('CRITICAL ERROR: About to autosave with empty caption!', {
          contentId: content.id,
          originalCaption,
          newCaption: debouncedFormData.caption,
          hasChanges,
          formData: debouncedFormData
        })
        return
      }

      console.log('Autosaving content:', { 
        contentId: content.id, 
        originalCaption: originalCaption.substring(0, 30) + '...', 
        newCaption: debouncedFormData.caption.substring(0, 30) + '...',
        imageUrl: debouncedFormData.imageUrl,
        scheduledAt: debouncedFormData.scheduledAt,
        originalScheduledAt: originalScheduledAt
      })

      // Always include scheduledAt in the mutation, even if empty
      updateContentMutation.mutate({
        contentId: content.id,
        caption: debouncedFormData.caption,
        hashtags: debouncedFormData.hashtags,
        imageUrl: debouncedFormData.imageUrl || undefined,
        scheduledAt: debouncedFormData.scheduledAt // Send empty string if cleared, datetime string if set
      })
    }
  }, [debouncedFormData, content, isOpen, updateContentMutation])

  const handleCaptionChange = (value: string) => {
    setFormData(prev => ({ ...prev, caption: value }))
  }

  const handleImageChange = async (fileOrUrl: string | File) => {
    if (typeof fileOrUrl === 'string') {
      // Direct URL update (e.g., when removing the image)
      setFormData(prev => ({ ...prev, imageUrl: fileOrUrl }))
      
      // If it's an empty string, it means the user removed the image
      // This will trigger the auto-save via the debounced form data
      if (fileOrUrl === '' && content) {
        // Clear the CDN URL as well
        content.cdnImageUrl = undefined
        content.imageUrl = ''
      }
    } else {
      // File upload - create local preview immediately
      const objectUrl = URL.createObjectURL(fileOrUrl)
      setFormData(prev => ({ ...prev, imageUrl: objectUrl }))
      
      // Upload to server
      if (content) {
        setSaveStatus('saving')
        try {
          const response = await apiClient.uploadContentImage(content.id, fileOrUrl)
          if (response.success && response.content) {
            // Update with the server's response - use cdnImageUrl if available
            const newImageUrl = response.content.cdnImageUrl || response.content.imageUrl || objectUrl
            setFormData(prev => ({ 
              ...prev, 
              imageUrl: newImageUrl 
            }))
            setSaveStatus('saved')
            setLastSaved(new Date())
            
            // Update the content object to reflect the new CDN URL
            content.cdnImageUrl = response.content.cdnImageUrl
            content.imageUrl = response.content.imageUrl
            
            // Update the content in cache
            updateContentInCache({
              ...content,
              imageUrl: response.content.imageUrl,
              cdnImageUrl: response.content.cdnImageUrl
            })
            
            // Invalidate queries to refresh data
            queryClient.invalidateQueries({ queryKey: ['contentHistory'] })
            
            setTimeout(() => {
              setSaveStatus('idle')
            }, 2000)
          }
        } catch (error) {
          console.error('Failed to upload image:', error)
          setSaveStatus('error')
          // Revert to previous image on error
          setFormData(prev => ({ ...prev, imageUrl: content.imageUrl || '' }))
          setTimeout(() => {
            setSaveStatus('idle')
          }, 3000)
        }
      }
    }
  }
  
  const handleImageUpload = async (file: File): Promise<string> => {
    if (!content) {
      throw new Error('No content available for image upload')
    }
    
    const response = await apiClient.uploadContentImage(content.id, file)
    if (response.success && response.content.imageUrl) {
      return response.content.imageUrl
    }
    throw new Error('Failed to upload image')
  }

  const handleScheduledAtChange = (value: string) => {
    console.log('Scheduled time changed:', { 
      from: formData.scheduledAt, 
      to: value,
      contentId: content?.id 
    })
    setFormData(prev => ({ ...prev, scheduledAt: value }))
    
    // Trigger immediate save for scheduled time changes
    if (content && content.id) {
      setSaveStatus('saving')
      updateContentMutation.mutate({
        contentId: content.id,
        caption: formData.caption,
        hashtags: formData.hashtags,
        imageUrl: formData.imageUrl || undefined,
        scheduledAt: value // Use the new value directly
      })
    }
  }

  const handleHashtagInputChange = (value: string) => {
    setHashtagInput(value)
    
    // Parse hashtags from input
    const hashtags = value
      .split(/\s+/)
      .filter(tag => tag.trim().length > 0)
      .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
      .filter(tag => tag.length > 1)
    
    setFormData(prev => ({ ...prev, hashtags }))
  }

  const removeHashtag = (index: number) => {
    const newHashtags = formData.hashtags.filter((_, i) => i !== index)
    setFormData(prev => ({ ...prev, hashtags: newHashtags }))
    setHashtagInput(newHashtags.join(' '))
  }

  const handleClose = () => {
    setSaveStatus('idle')
    setLastSaved(null)
    onClose()
  }

  const getSaveStatusIcon = () => {
    switch (saveStatus) {
      case 'saving':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
      case 'saved':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />
      default:
        return <Save className="w-4 h-4 text-gray-400" />
    }
  }

  const getSaveStatusText = () => {
    switch (saveStatus) {
      case 'saving':
        return 'Saving...'
      case 'saved':
        return 'AI is learning from your edits and improving future content...'
      case 'error':
        return 'Failed to save'
      default:
        return lastSaved ? `Last saved: ${format(lastSaved, 'HH:mm:ss')}` : 'Auto-save enabled'
    }
  }

  if (!content) return null

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Post</DialogTitle>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            {getSaveStatusIcon()}
            <span>{getSaveStatusText()}</span>
          </div>
        </DialogHeader>

        {/* Learning Feedback Banner */}
        {learningFeedback.isVisible && (
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-4 mb-4 animate-in slide-in-from-top duration-300">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-blue-600" />
                <Sparkles className="w-4 h-4 text-purple-600" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">
                  {learningFeedback.message}
                </div>
                {learningFeedback.appliedToFuturePosts && (
                  <div className="text-xs text-gray-600 mt-1">
                    Improvements applied to ~{learningFeedback.appliedToFuturePosts} future posts
                  </div>
                )}
              </div>
              <button
                onClick={() => setLearningFeedback({ isVisible: false, message: '' })}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Dismiss learning notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {/* Caption */}
          <div className="space-y-2">
            <Label htmlFor="caption">Caption</Label>
            <Textarea
              id="caption"
              value={formData.caption}
              onChange={(e) => handleCaptionChange(e.target.value)}
              placeholder="Write your caption..."
              className="min-h-32 resize-none"
            />
            <div className="text-xs text-gray-500 text-right">
              {formData.caption.length} characters
            </div>
          </div>

          {/* Hashtags */}
          <div className="space-y-2">
            <Label htmlFor="hashtags">Hashtags</Label>
            <Input
              id="hashtags"
              value={hashtagInput}
              onChange={(e) => handleHashtagInputChange(e.target.value)}
              placeholder="Add hashtags separated by spaces (e.g., #fashion #style #ootd)"
            />
            {formData.hashtags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.hashtags.map((hashtag, index) => (
                  <Badge
                    key={index}
                    variant="secondary"
                    className="cursor-pointer hover:bg-red-100 hover:text-red-800"
                    onClick={() => removeHashtag(index)}
                  >
                    {hashtag} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Image Upload */}
          <div className="space-y-2">
            <Label>Post Image</Label>
            <ImageUploader
              value={formData.imageUrl || content.cdnImageUrl || content.imageUrl}
              onChange={handleImageChange}
              onUpload={handleImageUpload}
              maxSizeInMB={10}
              acceptedFormats={['image/jpeg', 'image/jpg', 'image/png', 'image/webp']}
            />
          </div>

          {/* Scheduled Time */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="scheduledAt">Scheduled Time</Label>
              {formData.scheduledAt && (
                <button
                  type="button"
                  onClick={() => handleScheduledAtChange('')}
                  className="text-xs text-gray-500 hover:text-red-600"
                >
                  Clear
                </button>
              )}
            </div>
            <Input
              id="scheduledAt"
              type="datetime-local"
              value={formData.scheduledAt}
              onChange={(e) => handleScheduledAtChange(e.target.value)}
            />
            {formData.scheduledAt && (
              <div className="text-xs text-gray-500">
                Scheduled for: {format(new Date(formData.scheduledAt), 'EEEE, MMMM d, yyyy \'at\' h:mm a')}
              </div>
            )}
          </div>

          {/* Post Status */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm font-medium text-gray-700 mb-2">Post Status</div>
            <div className="flex items-center gap-2">
              <Badge 
                variant={
                  content.status === 'pending' ? 'secondary' :
                  content.status === 'approved' ? 'default' :
                  content.status === 'published' ? 'secondary' : 'destructive'
                }
              >
                {content.status.charAt(0).toUpperCase() + content.status.slice(1)}
              </Badge>
              <span className="text-xs text-gray-500">
                Created: {format(new Date(content.createdAt), 'MMM d, yyyy \'at\' h:mm a')}
              </span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}