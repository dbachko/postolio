import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, type Content } from '../lib/api'

interface ContentCardProps {
  content: Content
  brandId: string
}

export function ContentCard({ content, brandId }: ContentCardProps) {
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [scheduledDate, setScheduledDate] = useState('')
  const [publishError, setPublishError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const approveMutation = useMutation({
    mutationFn: (data: { contentId: string; scheduledAt?: string }) =>
      apiClient.approveContent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingContent', brandId] })
      setShowScheduleModal(false)
      setScheduledDate('')
    },
  })

  const rejectMutation = useMutation({
    mutationFn: (contentId: string) => apiClient.rejectContent(contentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingContent', brandId] })
    },
  })

  const publishMutation = useMutation({
    mutationFn: (contentId: string) => apiClient.publishToInstagram(contentId),
    onSuccess: () => {
      setPublishError(null)
      queryClient.invalidateQueries({ queryKey: ['pendingContent', brandId] })
      queryClient.invalidateQueries({ queryKey: ['contentHistory', brandId] })
    },
    onError: (error: any) => {
      const errorMessage = error?.message || 'Failed to publish to Instagram. Please try again.'
      setPublishError(errorMessage)
    },
  })

  const handleApprove = () => {
    if (scheduledDate) {
      approveMutation.mutate({
        contentId: content.id,
        scheduledAt: new Date(scheduledDate).toISOString(),
      })
    } else {
      approveMutation.mutate({ contentId: content.id })
    }
  }

  const handleReject = () => {
    rejectMutation.mutate(content.id)
  }

  const handleSchedule = () => {
    setShowScheduleModal(true)
  }

  const handlePublish = () => {
    setPublishError(null)
    publishMutation.mutate(content.id)
  }

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      {content.imageUrl && (
        <div className="aspect-w-16 aspect-h-9">
          <img
            src={content.imageUrl}
            alt="Generated content"
            className="w-full h-48 object-cover"
          />
        </div>
      )}
      
      <div className="p-4">
        <div className="mb-3">
          <p className="text-gray-900 text-sm leading-relaxed">
            {content.caption}
          </p>
        </div>

        <div className="mb-4">
          <div className="flex flex-wrap gap-1">
            {content.hashtags.map((tag, index) => (
              <span
                key={index}
                className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              content.status === 'pending'
                ? 'bg-yellow-100 text-yellow-800'
                : content.status === 'approved'
                ? 'bg-green-100 text-green-800'
                : content.status === 'rejected'
                ? 'bg-red-100 text-red-800'
                : 'bg-blue-100 text-blue-800'
            }`}
          >
            {content.status.charAt(0).toUpperCase() + content.status.slice(1)}
          </span>

          {content.status === 'pending' && (
            <div className="flex space-x-2">
              <button
                onClick={handleSchedule}
                className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                disabled={approveMutation.isPending}
              >
                Schedule
              </button>
              <button
                onClick={handleApprove}
                className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                disabled={approveMutation.isPending}
              >
                Approve Now
              </button>
              <button
                onClick={handleReject}
                className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                disabled={rejectMutation.isPending}
              >
                Reject
              </button>
            </div>
          )}

          {content.status === 'approved' && (
            <div className="flex flex-col space-y-2">
              <div className="flex space-x-2">
                <button
                  onClick={handlePublish}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded text-sm hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  disabled={publishMutation.isPending}
                >
                  {publishMutation.isPending ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent"></div>
                      Publishing...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2z"/>
                        <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/>
                        <circle cx="17.5" cy="6.5" r="1"/>
                      </svg>
                      Publish to Instagram
                    </>
                  )}
                </button>
              </div>
              {publishError && (
                <div className="bg-red-50 border border-red-200 rounded p-2">
                  <p className="text-xs text-red-800">{publishError}</p>
                </div>
              )}
            </div>
          )}

          {content.status === 'posted' && content.instagramPermalink && (
            <div className="flex space-x-2">
              <a
                href={content.instagramPermalink}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gray-100 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-200 flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                View on Instagram
              </a>
            </div>
          )}
        </div>

        {content.scheduledAt && (
          <div className="mt-2 text-xs text-gray-500">
            Scheduled for: {new Date(content.scheduledAt).toLocaleString()}
          </div>
        )}
      </div>

      {/* Schedule Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-lg font-medium mb-4">Schedule Content</h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Schedule Date & Time
              </label>
              <input
                type="datetime-local"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                min={new Date().toISOString().slice(0, 16)}
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowScheduleModal(false)}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                disabled={!scheduledDate || approveMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {approveMutation.isPending ? 'Scheduling...' : 'Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}