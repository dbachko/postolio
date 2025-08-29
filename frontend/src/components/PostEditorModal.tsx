import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { apiClient, type Content } from '../lib/api'
import { ImageUploader } from './ImageUploader'
import { PostCaptionEditor } from './PostCaptionEditor'
import { PostHashtagEditor } from './PostHashtagEditor'
import { PostScheduler } from './PostScheduler'
import { PostStatusCard } from './PostStatusCard'
import { PostSaveIndicator, type SaveStatus } from './PostSaveIndicator'
import { PostLearningFeedback } from './PostLearningFeedback'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog'
import { Label } from './ui/label'
import { Button } from './ui/button'
import { Save } from 'lucide-react'

interface PostEditorModalProps {
  content: Content | null
  isOpen: boolean
  onClose: () => void
}

interface FormData {
  caption: string
  hashtags: string[]
  cdnImageUrl: string
  scheduledAt: string
}

export function PostEditorModal({ content, isOpen, onClose }: PostEditorModalProps) {
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<FormData>({
    caption: '',
    hashtags: [],
    cdnImageUrl: '',
    scheduledAt: ''
  })
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [hasChanges, setHasChanges] = useState(false)
  const [showLearningMessage, setShowLearningMessage] = useState(false)
  const objectUrlRef = useRef<string | null>(null) // Track object URLs for cleanup
  const originalDataRef = useRef<FormData | null>(null) // Track original data for comparison
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
            item.id === updatedContent.id ? { ...item, ...updatedContent } : item
          )
        }
      }
      return oldData
    })
  }

  // Initialize form data when content changes
  useEffect(() => {
    if (content && isOpen) {
      const initialData = {
        caption: content.caption || '',
        hashtags: content.hashtags || [],
        cdnImageUrl: content.cdnImageUrl || '',
        scheduledAt: content.scheduledAt ? format(new Date(content.scheduledAt), "yyyy-MM-dd'T'HH:mm") : ''
      }
      setFormData(initialData)
      originalDataRef.current = initialData
      setHasChanges(false)
      setShowLearningMessage(false)
    }
  }, [content, isOpen])

  // Reset form data when modal is closed
  useEffect(() => {
    if (!isOpen) {
      console.log('Modal closed - resetting form data')
      setFormData({
        caption: '',
        hashtags: [],
        cdnImageUrl: '',
        scheduledAt: ''
      })
      setLearningFeedback({ isVisible: false, message: '' })
      setSaveStatus('idle')
      setHasChanges(false)
      setShowLearningMessage(false)
      originalDataRef.current = null
      // Clean up object URL when modal closes
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [isOpen])

  // Clean up object URL on component unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [])

  // Check for changes and show learning message
  const checkForChanges = (newData: FormData) => {
    if (!originalDataRef.current) return false
    
    const hasFormChanges = 
      newData.caption !== originalDataRef.current.caption ||
      JSON.stringify(newData.hashtags) !== JSON.stringify(originalDataRef.current.hashtags) ||
      newData.cdnImageUrl !== originalDataRef.current.cdnImageUrl ||
      newData.scheduledAt !== originalDataRef.current.scheduledAt
    
    setHasChanges(hasFormChanges)
    
    // Show learning message when user makes edits to caption or hashtags
    if (hasFormChanges && !showLearningMessage) {
      const textChanged = newData.caption !== originalDataRef.current.caption || 
                         JSON.stringify(newData.hashtags) !== JSON.stringify(originalDataRef.current.hashtags)
      if (textChanged) {
        setShowLearningMessage(true)
      }
    }
    
    return hasFormChanges
  }


  const updateContentMutation = useMutation({
    mutationFn: (data: {
      contentId: string
      caption?: string
      hashtags?: string[]
      cdnImageUrl?: string
      scheduledAt?: string
    }) => {
      // Critical logging before mutation
      console.log('MUTATION CALL:', {
        contentId: data.contentId,
        caption: data.caption,
        captionLength: data.caption?.length || 0,
        hashtags: data.hashtags,
        cdnImageUrl: data.cdnImageUrl,
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

      // Cache is already updated, no need to invalidate
      
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

  // Manual save function
  const saveChanges = async () => {
    if (!content || !hasChanges) return
    
    // Safety check: Never save with empty caption
    if (!formData.caption || formData.caption.trim().length === 0) {
      console.error('Cannot save with empty caption')
      return
    }
    
    console.log('💾 Manually saving content:', { 
      contentId: content.id, 
      caption: formData.caption.substring(0, 30) + '...',
      timestamp: new Date().toISOString()
    })
    
    updateContentMutation.mutate({
      contentId: content.id,
      caption: formData.caption,
      hashtags: formData.hashtags,
      cdnImageUrl: formData.cdnImageUrl || undefined,
      scheduledAt: formData.scheduledAt
    })
    
    // Update the original data reference after successful save
    originalDataRef.current = formData
    setHasChanges(false)
  }

  const handleCaptionChange = (value: string) => {
    const newData = { ...formData, caption: value }
    setFormData(newData)
    checkForChanges(newData)
  }

  const handleHashtagsChange = (hashtags: string[]) => {
    const newData = { ...formData, hashtags }
    setFormData(newData)
    checkForChanges(newData)
  }

  const handleImageChange = async (fileOrUrl: string | File) => {
    if (typeof fileOrUrl === 'string') {
      // Direct URL update (e.g., when removing the image)
      const newData = { ...formData, cdnImageUrl: fileOrUrl }
      setFormData(newData)
      checkForChanges(newData)
    } else {
      // File upload - create local preview immediately
      // Revoke previous object URL if it exists
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
      const objectUrl = URL.createObjectURL(fileOrUrl)
      objectUrlRef.current = objectUrl
      setFormData(prev => ({ ...prev, cdnImageUrl: objectUrl }))
      
      // Upload to server
      if (content) {
        setSaveStatus('saving')
        try {
          const response = await apiClient.uploadContentImage(content.id, fileOrUrl)
          if (response.success && response.content) {
            // Update with the server's response - use cdnImageUrl if available
            const newImageUrl = response.content.cdnImageUrl || objectUrl
            const newData = { ...formData, cdnImageUrl: newImageUrl }
            setFormData(newData)
            checkForChanges(newData)
            setSaveStatus('saved')
            setLastSaved(new Date())
            
            // Clean up the object URL since we now have the server URL
            if (objectUrlRef.current) {
              URL.revokeObjectURL(objectUrlRef.current)
              objectUrlRef.current = null
            }
            
            // Update the content in cache without mutating the original
            updateContentInCache({
              ...content,
              cdnImageUrl: response.content.cdnImageUrl
            })
            
            // Cache is already updated, no need to invalidate
            
            setTimeout(() => {
              setSaveStatus('idle')
            }, 2000)
          }
        } catch (error) {
          console.error('Failed to upload image:', error)
          setSaveStatus('error')
          // Revert to previous image on error
          setFormData(prev => ({ ...prev, cdnImageUrl: content.cdnImageUrl || '' }))
          setTimeout(() => {
            setSaveStatus('idle')
          }, 3000)
        }
      }
    }
  }

  const handleScheduledAtChange = (value: string) => {
    console.log('Scheduled time changed:', { 
      from: formData.scheduledAt, 
      to: value,
      contentId: content?.id 
    })
    const newData = { ...formData, scheduledAt: value }
    setFormData(newData)
    checkForChanges(newData)
  }

  const handleClose = async () => {
    // Save changes on close if there are any
    if (hasChanges) {
      await saveChanges()
    }
    setSaveStatus('idle')
    setLastSaved(null)
    onClose()
  }

  const handleDismissLearning = () => {
    setLearningFeedback({ isVisible: false, message: '' })
  }

  if (!content) return null

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Post</DialogTitle>
          <PostSaveIndicator
            status={saveStatus}
            lastSaved={lastSaved}
            showAILearningMessage={showLearningMessage && hasChanges}
          />
        </DialogHeader>

        <PostLearningFeedback
          isVisible={learningFeedback.isVisible}
          message={learningFeedback.message}
          appliedToFuturePosts={learningFeedback.appliedToFuturePosts}
          onDismiss={handleDismissLearning}
          className="mb-4"
        />

        <div className="space-y-6">
          <PostCaptionEditor
            value={formData.caption}
            onChange={handleCaptionChange}
          />

          <PostHashtagEditor
            hashtags={formData.hashtags}
            onChange={handleHashtagsChange}
          />

          {/* Image Upload */}
          <div className="space-y-2">
            <Label>Post Image</Label>
            <ImageUploader
              value={formData.cdnImageUrl || content.cdnImageUrl || undefined}
              onChange={handleImageChange}
              maxSizeInMB={10}
              acceptedFormats={['image/jpeg', 'image/jpg', 'image/png', 'image/webp']}
            />
          </div>

          <PostScheduler
            value={formData.scheduledAt}
            onChange={handleScheduledAtChange}
          />

          <PostStatusCard
            status={content.status as 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped'}
            createdAt={content.createdAt}
          />
        </div>
        
        <DialogFooter>
          <Button
            onClick={saveChanges}
            disabled={!hasChanges || updateContentMutation.isLoading}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}