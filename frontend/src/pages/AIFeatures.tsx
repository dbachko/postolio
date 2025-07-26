import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiClient } from '../lib/api'
import { useBrandStore } from '../stores/brandStore'

export function AIFeatures() {
  const { selectedBrand } = useBrandStore()
  const [activeTab, setActiveTab] = useState<'hashtags' | 'competitors' | 'content' | 'schedule'>('hashtags')

  // Hashtag optimization state
  const [content, setContent] = useState('')
  const [currentHashtags, setCurrentHashtags] = useState('')
  const [hashtagResults, setHashtagResults] = useState<any>(null)

  // Competitor analysis state
  const [competitors, setCompetitors] = useState('')
  const [competitorResults, setCompetitorResults] = useState<any>(null)

  // Content suggestions state
  const [context, setContext] = useState('')
  const [contentType, setContentType] = useState<'post' | 'story' | 'reel'>('post')
  const [contentSuggestions, setContentSuggestions] = useState<any>(null)

  // Schedule optimization state
  const [scheduleResults, setScheduleResults] = useState<any>(null)

  const hashtagMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiClient.post('/ai/hashtags/optimize', data)
    },
    onSuccess: (data) => setHashtagResults(data)
  })

  const competitorMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiClient.post('/ai/competitors/analyze', data)
    },
    onSuccess: (data: any) => setCompetitorResults(data.analysis)
  })

  const contentMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiClient.post('/ai/content/suggestions', data)
    },
    onSuccess: (data: any) => setContentSuggestions(data.suggestions)
  })

  const scheduleMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiClient.post('/ai/schedule/optimize', data)
    },
    onSuccess: (data: any) => setScheduleResults(data.optimizedSchedule)
  })

  const handleHashtagOptimization = () => {
    if (!selectedBrand || !content) return
    
    const hashtags = currentHashtags.split(',').map(h => h.trim()).filter(h => h)
    hashtagMutation.mutate({
      brandId: selectedBrand.id,
      content,
      currentHashtags: hashtags
    })
  }

  const handleCompetitorAnalysis = () => {
    if (!selectedBrand || !competitors) return
    
    const competitorList = competitors.split(',').map(c => c.trim()).filter(c => c)
    competitorMutation.mutate({
      brandId: selectedBrand.id,
      competitors: competitorList
    })
  }

  const handleContentSuggestions = () => {
    if (!selectedBrand || !context) return
    
    contentMutation.mutate({
      brandId: selectedBrand.id,
      context,
      contentType
    })
  }

  const handleScheduleOptimization = () => {
    if (!selectedBrand) return
    
    scheduleMutation.mutate({
      brandId: selectedBrand.id
    })
  }

  if (!selectedBrand) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Please select a brand to access AI features</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">AI-Powered Features</h1>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'hashtags', name: 'Hashtag Optimizer' },
            { id: 'competitors', name: 'Competitor Analysis' },
            { id: 'content', name: 'Content Ideas' },
            { id: 'schedule', name: 'Schedule Optimizer' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Hashtag Optimizer */}
      {activeTab === 'hashtags' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">AI Hashtag Optimizer</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Content Description
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Describe your content (e.g., 'Beautiful sunset photography session')"
                className="w-full border rounded-md px-3 py-2 h-24"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Current Hashtags (comma-separated)
              </label>
              <input
                type="text"
                value={currentHashtags}
                onChange={(e) => setCurrentHashtags(e.target.value)}
                placeholder="#photography, #sunset"
                className="w-full border rounded-md px-3 py-2"
              />
            </div>
            
            <button
              onClick={handleHashtagOptimization}
              disabled={hashtagMutation.isPending || !content}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {hashtagMutation.isPending ? 'Optimizing...' : 'Optimize Hashtags'}
            </button>
          </div>

          {hashtagResults && (
            <div className="mt-6 space-y-4">
              <div>
                <h3 className="font-medium text-gray-900 mb-2">Optimized Hashtags</h3>
                <div className="flex flex-wrap gap-2">
                  {hashtagResults.optimizedHashtags.map((tag: string, index: number) => (
                    <span key={index} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded">
                  <h4 className="font-medium mb-2">Relevance Score</h4>
                  <p className="text-2xl font-bold text-green-600">{hashtagResults.relevanceScore}%</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <h4 className="font-medium mb-2">Competition Level</h4>
                  <p className={`text-lg font-semibold ${
                    hashtagResults.analytics.competitionLevel === 'low' ? 'text-green-600' :
                    hashtagResults.analytics.competitionLevel === 'medium' ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {hashtagResults.analytics.competitionLevel.toUpperCase()}
                  </p>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium mb-2">Additional Suggestions</h4>
                <div className="flex flex-wrap gap-2">
                  {hashtagResults.suggestions.map((tag: string, index: number) => (
                    <span key={index} className="bg-green-100 text-green-800 px-2 py-1 rounded text-sm">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Competitor Analysis */}
      {activeTab === 'competitors' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Competitor Analysis</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Competitor Handles (comma-separated)
              </label>
              <input
                type="text"
                value={competitors}
                onChange={(e) => setCompetitors(e.target.value)}
                placeholder="@competitor1, @competitor2"
                className="w-full border rounded-md px-3 py-2"
              />
            </div>
            
            <button
              onClick={handleCompetitorAnalysis}
              disabled={competitorMutation.isPending || !competitors}
              className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 disabled:opacity-50"
            >
              {competitorMutation.isPending ? 'Analyzing...' : 'Analyze Competitors'}
            </button>
          </div>

          {competitorResults && (
            <div className="mt-6 space-y-6">
              <div>
                <h3 className="font-medium text-gray-900 mb-4">Competitor Insights</h3>
                <div className="space-y-4">
                  {competitorResults.competitorInsights.map((comp: any, index: number) => (
                    <div key={index} className="border rounded-lg p-4">
                      <h4 className="font-semibold">{comp.handle}</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
                        <div>
                          <span className="text-sm text-gray-500">Followers</span>
                          <p className="font-medium">{comp.followers.toLocaleString()}</p>
                        </div>
                        <div>
                          <span className="text-sm text-gray-500">Engagement</span>
                          <p className="font-medium">{comp.engagementRate}%</p>
                        </div>
                        <div>
                          <span className="text-sm text-gray-500">Post Frequency</span>
                          <p className="font-medium">{comp.postFrequency}/week</p>
                        </div>
                        <div>
                          <span className="text-sm text-gray-500">Top Hashtags</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {comp.topHashtags.slice(0, 3).map((tag: string, i: number) => (
                              <span key={i} className="text-xs bg-gray-100 px-1 rounded">{tag}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h3 className="font-medium text-gray-900 mb-3">Recommendations</h3>
                <ul className="space-y-2">
                  {competitorResults.recommendations.map((rec: string, index: number) => (
                    <li key={index} className="flex items-start">
                      <span className="text-blue-500 mr-2">•</span>
                      <span className="text-gray-700">{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content Suggestions */}
      {activeTab === 'content' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">AI Content Suggestions</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Context/Theme
              </label>
              <input
                type="text"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="e.g., holiday season, spring, new product launch"
                className="w-full border rounded-md px-3 py-2"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Content Type
              </label>
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value as any)}
                className="w-full border rounded-md px-3 py-2"
              >
                <option value="post">Post</option>
                <option value="story">Story</option>
                <option value="reel">Reel</option>
              </select>
            </div>
            
            <button
              onClick={handleContentSuggestions}
              disabled={contentMutation.isPending || !context}
              className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {contentMutation.isPending ? 'Generating...' : 'Generate Ideas'}
            </button>
          </div>

          {contentSuggestions && (
            <div className="mt-6 space-y-4">
              {contentSuggestions.map((suggestion: any, index: number) => (
                <div key={index} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold">{suggestion.title}</h3>
                    <div className="flex space-x-2">
                      <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                        {suggestion.contentType}
                      </span>
                      <span className={`px-2 py-1 rounded text-xs ${
                        suggestion.difficulty === 'easy' ? 'bg-green-100 text-green-800' :
                        suggestion.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {suggestion.difficulty}
                      </span>
                    </div>
                  </div>
                  <p className="text-gray-600 mb-3">{suggestion.description}</p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-medium text-sm mb-2">Suggested Hashtags</h4>
                      <div className="flex flex-wrap gap-1">
                        {suggestion.suggestedHashtags.map((tag: string, i: number) => (
                          <span key={i} className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium text-sm mb-2">Resources Needed</h4>
                      <ul className="text-sm text-gray-600">
                        {suggestion.resources.map((resource: string, i: number) => (
                          <li key={i}>• {resource}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  
                  <div className="mt-3 text-sm">
                    <span className="font-medium">Estimated Engagement: </span>
                    <span className="text-green-600 font-semibold">{suggestion.estimatedEngagement}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Schedule Optimizer */}
      {activeTab === 'schedule' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">AI Schedule Optimizer</h2>
          
          <div className="space-y-4">
            <button
              onClick={handleScheduleOptimization}
              disabled={scheduleMutation.isPending}
              className="bg-orange-600 text-white px-4 py-2 rounded-md hover:bg-orange-700 disabled:opacity-50"
            >
              {scheduleMutation.isPending ? 'Optimizing...' : 'Optimize Schedule'}
            </button>
          </div>

          {scheduleResults && (
            <div className="mt-6 space-y-6">
              <div>
                <h3 className="font-medium text-gray-900 mb-4">Optimal Posting Times</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {scheduleResults.recommendedTimes.map((time: any, index: number) => (
                    <div key={index} className="border rounded p-3">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{time.day}</span>
                        <span className="text-blue-600 font-semibold">{time.time}</span>
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        Engagement: {time.engagement}% | Reach: {time.reach.toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h3 className="font-medium text-gray-900 mb-3">Frequency Recommendations</h3>
                <div className="bg-blue-50 p-4 rounded">
                  <p className="text-lg font-semibold text-blue-800">{scheduleResults.frequency.optimal}</p>
                  <p className="text-sm text-blue-600 mt-1">
                    Current average: {scheduleResults.frequency.daily} posts/day
                  </p>
                </div>
              </div>
              
              <div>
                <h3 className="font-medium text-gray-900 mb-3">AI Insights</h3>
                <ul className="space-y-2">
                  {scheduleResults.insights.map((insight: string, index: number) => (
                    <li key={index} className="flex items-start">
                      <span className="text-orange-500 mr-2">💡</span>
                      <span className="text-gray-700">{insight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}