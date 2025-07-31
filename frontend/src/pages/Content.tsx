import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient, type Content } from '../lib/api'
import { ContentCard } from '../components/ContentCard'
import { CalendarView } from '../components/CalendarView'
import { PostEditor } from '../components/PostEditor'
import { useBrandStore } from '../stores/brandStore'
import { ArrowRight, Calendar, Activity } from 'lucide-react'
import { Link } from 'react-router-dom'

export function Content() {
  const [activeTab, setActiveTab] = useState<'pending' | 'history' | 'calendar'>('pending')
  const [selectedContent, setSelectedContent] = useState<Content | null>(null)
  const [isPostEditorOpen, setIsPostEditorOpen] = useState(false)
  
  const { brands, selectedBrand, setBrands, initializeSelectedBrand } = useBrandStore()
  
  const { data: brandsData } = useQuery({
    queryKey: ['brands'],
    queryFn: () => apiClient.getBrands(),
  })

  useEffect(() => {
    if (brandsData?.brands) {
      setBrands(brandsData.brands)
      initializeSelectedBrand(brandsData.brands)
    }
  }, [brandsData, setBrands, initializeSelectedBrand])

  const activeBrand = selectedBrand

  const { data: pendingContentData, isLoading: pendingLoading } = useQuery({
    queryKey: ['pendingContent', activeBrand?.id],
    queryFn: () => activeBrand ? apiClient.getPendingContent(activeBrand.id) : null,
    enabled: !!activeBrand,
  })

  const { data: historyContentData, isLoading: historyLoading } = useQuery({
    queryKey: ['contentHistory', activeBrand?.id],
    queryFn: () => activeBrand ? apiClient.getContentHistory(activeBrand.id) : null,
    enabled: !!activeBrand && activeTab === 'history',
  })

  const pendingContent = pendingContentData?.content || []
  const historyContent = historyContentData?.content || []
  const allContent = [...pendingContent, ...historyContent]

  const handleContentClick = (content: Content) => {
    setSelectedContent(content)
    setIsPostEditorOpen(true)
  }

  const handlePostEditorClose = () => {
    setIsPostEditorOpen(false)
    setSelectedContent(null)
  }

  if (brands.length === 0) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">No Brands Available</h2>
        <p className="text-gray-600 mb-6">Create a brand first to start generating content.</p>
        <a
          href="/brands"
          className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
        >
          Create Brand
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content Management</h1>
          <p className="text-gray-600">Monitor and manage your campaign content</p>
          {activeBrand && (
            <p className="text-sm text-gray-500 mt-1">Working with: {activeBrand.name}</p>
          )}
        </div>
      </div>

      {/* Autopilot Direction Card */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Activity className="w-6 h-6 text-blue-600" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Create New Content</h3>
                <p className="text-sm text-gray-600">Use Autopilot to create and schedule campaign content automatically</p>
              </div>
            </div>
          </div>
          <Link
            to="/autopilot"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Go to Autopilot
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex">
            <button
              onClick={() => setActiveTab('pending')}
              className={`py-2 px-4 border-b-2 font-medium text-sm ${
                activeTab === 'pending'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Pending Approval ({pendingContent.length})
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`py-2 px-4 border-b-2 font-medium text-sm ${
                activeTab === 'history'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Content History
            </button>
            <button
              onClick={() => setActiveTab('calendar')}
              className={`py-2 px-4 border-b-2 font-medium text-sm ${
                activeTab === 'calendar'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Calendar View
            </button>
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'pending' ? (
            pendingLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
              </div>
            ) : pendingContent.length === 0 ? (
              <div className="text-center py-8">
                <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500 mb-2">No pending content from campaigns</p>
                <p className="text-sm text-gray-400">Create a campaign in Autopilot to schedule content</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {pendingContent.map((content) => (
                  <ContentCard
                    key={content.id}
                    content={content}
                    brandId={activeBrand!.id}
                  />
                ))}
              </div>
            )
          ) : activeTab === 'history' ? (
            historyLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
              </div>
            ) : historyContent.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No content history yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {historyContent.map((content) => (
                  <ContentCard
                    key={content.id}
                    content={content}
                    brandId={activeBrand!.id}
                  />
                ))}
              </div>
            )
          ) : (
            <CalendarView 
              content={allContent}
              onContentClick={handleContentClick}
            />
          )}
        </div>
      </div>

      {/* Post Editor Modal */}
      <PostEditor
        content={selectedContent}
        isOpen={isPostEditorOpen}
        onClose={handlePostEditorClose}
      />
    </div>
  )
}