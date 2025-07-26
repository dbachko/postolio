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