import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { apiClient, type Content } from '../lib/api'
import { useDebounce } from '../hooks/useDebounce'
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
} from './ui/dialog'
import { Label } from './ui/label'

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
  const objectUrlRef = useRef<string | null>(null) // Track object URLs for cleanup
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
      setFormData({
        caption: content.caption || '',
        hashtags: content.hashtags || [],
        cdnImageUrl: content.cdnImageUrl || '',
        scheduledAt: content.scheduledAt ? format(new Date(content.scheduledAt), "yyyy-MM-dd'T'HH:mm") : ''
      })
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
          cdnImageUrl: content.cdnImageUrl || '',
          scheduledAt: content.scheduledAt ? format(new Date(content.scheduledAt), "yyyy-MM-dd'T'HH:mm") : ''
        })
      }
    }
  }, [content, isOpen]) // Removed formData.caption to prevent unnecessary effects

  // Debounced form data for auto-save
  const debouncedFormData = useDebounce(formData, 500)

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

  // Auto-save when debounced form data changes
  useEffect(() => {
    console.log('🔄 Auto-save useEffect triggered', { 
      hasContent: !!content, 
      isOpen, 
      debouncedCaption: debouncedFormData.caption?.substring(0, 20) 
    })
    
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
    if (debouncedFormData.caption === '' && debouncedFormData.hashtags.length === 0 && debouncedFormData.cdnImageUrl === '') {
      console.log('Skipping autosave: Form data appears to be empty initial state')
      return
    }

    // Check if form data has actually changed from original content
    const originalCaption = content.caption || ''
    const originalHashtags = content.hashtags || []
    const originalCdnImageUrl = content.cdnImageUrl || ''
    const originalScheduledAt = content.scheduledAt ? format(new Date(content.scheduledAt), "yyyy-MM-dd'T'HH:mm") : ''

    const hasChanges = 
      debouncedFormData.caption !== originalCaption ||
      JSON.stringify(debouncedFormData.hashtags) !== JSON.stringify(originalHashtags) ||
      debouncedFormData.cdnImageUrl !== originalCdnImageUrl ||
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

      console.log('✅ Autosaving content:', { 
        contentId: content.id, 
        originalCaption: originalCaption.substring(0, 30) + '...', 
        newCaption: debouncedFormData.caption.substring(0, 30) + '...',
        cdnImageUrl: debouncedFormData.cdnImageUrl,
        scheduledAt: debouncedFormData.scheduledAt,
        originalScheduledAt: originalScheduledAt,
        timestamp: new Date().toISOString()
      })

      // Always include scheduledAt in the mutation, even if empty
      updateContentMutation.mutate({
        contentId: content.id,
        caption: debouncedFormData.caption,
        hashtags: debouncedFormData.hashtags,
        cdnImageUrl: debouncedFormData.cdnImageUrl || undefined,
        scheduledAt: debouncedFormData.scheduledAt // Send empty string if cleared, datetime string if set
      })
    }
  }, [debouncedFormData, content, isOpen]) // FIXED: Removed updateContentMutation from dependencies

  const handleCaptionChange = (value: string) => {
    setFormData(prev => ({ ...prev, caption: value }))
  }

  const handleHashtagsChange = (hashtags: string[]) => {
    setFormData(prev => ({ ...prev, hashtags }))
  }

  const handleImageChange = async (fileOrUrl: string | File) => {
    if (typeof fileOrUrl === 'string') {
      // Direct URL update (e.g., when removing the image)
      setFormData(prev => ({ ...prev, cdnImageUrl: fileOrUrl }))
      
      // If it's an empty string, it means the user removed the image
      // This will trigger the auto-save via the debounced form data
      // No need to mutate content object - auto-save will handle it
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
            setFormData(prev => ({ 
              ...prev, 
              cdnImageUrl: newImageUrl 
            }))
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
    setFormData(prev => ({ ...prev, scheduledAt: value }))
    
    // Trigger immediate save for scheduled time changes
    if (content && content.id) {
      setSaveStatus('saving')
      updateContentMutation.mutate({
        contentId: content.id,
        caption: formData.caption,
        hashtags: formData.hashtags,
        cdnImageUrl: formData.cdnImageUrl || undefined,
        scheduledAt: value // Use the new value directly
      })
    }
  }

  const handleClose = () => {
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
            showAILearningMessage={saveStatus === 'saved'}
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
      </DialogContent>
    </Dialog>
  )
}