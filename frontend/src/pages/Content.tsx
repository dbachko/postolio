import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, type Content } from '../lib/api'
import { ContentCard } from '../components/ContentCard'
import { CalendarView } from '../components/CalendarView'
import { PostEditor } from '../components/PostEditor'
import { useBrandStore } from '../stores/brandStore'
import { Brain, TrendingUp, Target } from 'lucide-react'

export function Content() {
  const [generateForm, setGenerateForm] = useState({
    count: 3,
    theme: '',
    style: '',
  })
  const [activeTab, setActiveTab] = useState<'pending' | 'history' | 'calendar'>('pending')
  const [selectedContent, setSelectedContent] = useState<Content | null>(null)
  const [isPostEditorOpen, setIsPostEditorOpen] = useState(false)
  
  const queryClient = useQueryClient()
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

  const { data: learningAnalyticsData } = useQuery({
    queryKey: ['learningAnalytics', activeBrand?.id],
    queryFn: () => activeBrand ? apiClient.getLearningAnalytics(activeBrand.id) : null,
    enabled: !!activeBrand && !!activeBrand.styleProfile,
  })

  const generateContentMutation = useMutation({
    mutationFn: (data: { brandId: string; count: number; theme?: string; style?: string }) =>
      apiClient.generateContent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingContent', activeBrand?.id] })
      setGenerateForm({ count: 3, theme: '', style: '' })
    },
    onError: (error) => {
      console.error('Content generation error:', error)
    },
  })

  const pendingContent = pendingContentData?.content || []
  const historyContent = historyContentData?.content || []
  const allContent = [...pendingContent, ...historyContent]

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeBrand) return
    
    generateContentMutation.mutate({
      brandId: activeBrand.id,
      ...generateForm,
    })
  }

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
          <p className="text-gray-600">Generate and manage AI-created content for your brands</p>
          {activeBrand && (
            <p className="text-sm text-gray-500 mt-1">Working with: {activeBrand.name}</p>
          )}
        </div>
      </div>

      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Generate New Content</h2>
        
        {generateContentMutation.error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
            <p className="text-sm text-red-800">
              {generateContentMutation.error.message || 'Failed to generate content. Please try again.'}
            </p>
          </div>
        )}
        
        {activeBrand && !activeBrand.styleProfile && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4">
            <p className="text-sm text-yellow-800">
              This brand needs to be analyzed before generating content. Please analyze your Instagram posts first.
            </p>
          </div>
        )}

        {/* AI Learning Insights */}
        {activeBrand && activeBrand.styleProfile && learningAnalyticsData?.analytics && (
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-5 h-5 text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-900">AI Learning Insights</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-green-600" />
                <div>
                  <div className="text-xs text-gray-600">Learning Confidence</div>
                  <div className="text-sm font-medium">
                    {Math.round(learningAnalyticsData.analytics.learningConfidence * 100)}%
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-600" />
                <div>
                  <div className="text-xs text-gray-600">Content Acceptance</div>
                  <div className="text-sm font-medium">
                    {Math.round(learningAnalyticsData.analytics.improvementMetrics.contentAcceptanceRate * 100)}%
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-blue-600" />
                <div>
                  <div className="text-xs text-gray-600">Edits Analyzed</div>
                  <div className="text-sm font-medium">
                    {learningAnalyticsData.analytics.totalEditsAnalyzed}
                  </div>
                </div>
              </div>
            </div>
            {learningAnalyticsData.analytics.topInsights.length > 0 && (
              <div className="mt-3 pt-3 border-t border-blue-200">
                <div className="text-xs text-gray-700 font-medium mb-1">Latest Learning:</div>
                <div className="text-xs text-gray-600">
                  {learningAnalyticsData.analytics.topInsights[0].pattern}
                </div>
              </div>
            )}
          </div>
        )}
        
        <form onSubmit={handleGenerate} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="count" className="block text-sm font-medium text-gray-700">
                Number of Posts
              </label>
              <select
                id="count"
                value={generateForm.count}
                onChange={(e) => setGenerateForm({ ...generateForm, count: parseInt(e.target.value) })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value={1}>1 post</option>
                <option value={3}>3 posts</option>
                <option value={5}>5 posts</option>
                <option value={10}>10 posts</option>
              </select>
            </div>
            
            <div>
              <label htmlFor="theme" className="block text-sm font-medium text-gray-700">
                Theme (optional)
              </label>
              <input
                type="text"
                id="theme"
                value={generateForm.theme}
                onChange={(e) => setGenerateForm({ ...generateForm, theme: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., summer collection, behind the scenes"
              />
            </div>
            
            <div>
              <label htmlFor="style" className="block text-sm font-medium text-gray-700">
                Style (optional)
              </label>
              <input
                type="text"
                id="style"
                value={generateForm.style}
                onChange={(e) => setGenerateForm({ ...generateForm, style: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., professional, casual, creative"
              />
            </div>
          </div>
          
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={generateContentMutation.isPending || !activeBrand || !activeBrand.styleProfile}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {generateContentMutation.isPending ? 'Generating...' : 'Generate Content'}
            </button>
          </div>
        </form>
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
                <p className="text-gray-500">No pending content. Generate some content to get started!</p>
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