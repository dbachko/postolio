import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/api'
import { PageHeader } from '@/components/PageHeader'
import { useBrandStore } from '../stores/brandStore'

interface GrowthOpportunity {
  type: 'content' | 'engagement' | 'hashtags' | 'timing' | 'collaboration'
  title: string
  description: string
  impact: 'low' | 'medium' | 'high'
  effort: 'low' | 'medium' | 'high'
  priority: number
}

interface GrowthStrategy {
  id: string
  title: string
  description: string
  category: string
  actions: string[]
  timeframe: string
  expectedImpact: string
  resources: string[]
}


export function Growth() {
  const { selectedBrand } = useBrandStore()
  const [selectedFocus, setSelectedFocus] = useState<string>('')
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [strategiesLoading, setStrategiesLoading] = useState(false)

  const { data: analysis, refetch: refetchAnalysis } = useQuery({
    queryKey: ['growth-analysis', selectedBrand?.id],
    queryFn: async () => {
      if (!selectedBrand) return null
      const response = await apiClient.post(`/api/growth/analyze`, { brandId: selectedBrand.id })
      return (response as any).analysis
    },
    enabled: !!selectedBrand
  })

  const { data: strategies, refetch: refetchStrategies } = useQuery({
    queryKey: ['growth-strategies', selectedBrand?.id, selectedFocus],
    queryFn: async () => {
      if (!selectedBrand) return null
      const response = await apiClient.post(`/api/growth/strategies`, { 
        brandId: selectedBrand.id,
        focus: selectedFocus || undefined
      })
      return (response as any).strategies
    },
    enabled: !!selectedBrand
  })

  const { data: metrics } = useQuery({
    queryKey: ['growth-metrics', selectedBrand?.id],
    queryFn: async () => {
      if (!selectedBrand) return null
      const response = await apiClient.get(`/api/growth/metrics/${selectedBrand.id}?period=30`)
      return (response as any).metrics
    },
    enabled: !!selectedBrand
  })

  const handleAnalyze = async () => {
    setAnalysisLoading(true)
    try {
      await refetchAnalysis()
    } finally {
      setAnalysisLoading(false)
    }
  }

  const handleGenerateStrategies = async () => {
    setStrategiesLoading(true)
    try {
      await refetchStrategies()
    } finally {
      setStrategiesLoading(false)
    }
  }

  if (!selectedBrand) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Please select a brand to view growth strategies</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Growth Strategy Engine"
        actions={
          <button
            onClick={handleAnalyze}
            disabled={analysisLoading}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {analysisLoading ? 'Analyzing...' : 'Analyze Growth'}
          </button>
        }
      />

      {/* Growth Metrics Overview */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="text-sm font-medium text-gray-500">Growth Rate</h3>
            <p className="text-2xl font-bold text-green-600">{metrics.growthRate}%</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="text-sm font-medium text-gray-500">Reach</h3>
            <p className="text-2xl font-bold text-blue-600">{metrics.reach.toLocaleString()}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="text-sm font-medium text-gray-500">Engagement Rate</h3>
            <p className="text-2xl font-bold text-purple-600">{metrics.engagement}%</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="text-sm font-medium text-gray-500">Analysis Score</h3>
            <p className="text-2xl font-bold text-orange-600">{analysis?.score || 0}/100</p>
          </div>
        </div>
      )}

      {/* Growth Analysis */}
      {analysis && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Growth Analysis</h2>
          
          {/* Opportunities */}
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-3">Growth Opportunities</h3>
            <div className="space-y-3">
              {analysis.opportunities.map((opportunity: GrowthOpportunity, index: number) => (
                <div key={index} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium">{opportunity.title}</h4>
                      <p className="text-gray-600 text-sm mt-1">{opportunity.description}</p>
                    </div>
                    <div className="flex space-x-2">
                      <span className={`px-2 py-1 rounded text-xs ${
                        opportunity.impact === 'high' ? 'bg-red-100 text-red-800' :
                        opportunity.impact === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {opportunity.impact} impact
                      </span>
                      <span className={`px-2 py-1 rounded text-xs ${
                        opportunity.effort === 'high' ? 'bg-red-100 text-red-800' :
                        opportunity.effort === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {opportunity.effort} effort
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-3">Recommendations</h3>
            <ul className="space-y-2">
              {analysis.recommendations.map((rec: string, index: number) => (
                <li key={index} className="flex items-start">
                  <span className="text-blue-500 mr-2">•</span>
                  <span className="text-gray-700">{rec}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Next Actions */}
          <div>
            <h3 className="text-lg font-medium mb-3">Next Actions</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {analysis.nextActions.map((action: string, index: number) => (
                <div key={index} className="bg-blue-50 p-3 rounded border-l-4 border-blue-400">
                  <span className="text-blue-800 font-medium">{action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Strategy Generator */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Growth Strategies</h2>
          <div className="flex items-center space-x-3">
            <select
              value={selectedFocus}
              onChange={(e) => setSelectedFocus(e.target.value)}
              className="border rounded-md px-3 py-2"
            >
              <option value="">All Categories</option>
              <option value="content">Content Focus</option>
              <option value="engagement">Engagement Focus</option>
              <option value="growth">Growth Focus</option>
            </select>
            <button
              onClick={handleGenerateStrategies}
              disabled={strategiesLoading}
              className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {strategiesLoading ? 'Generating...' : 'Generate Strategies'}
            </button>
          </div>
        </div>

        {strategies && (
          <div className="space-y-6">
            {strategies.map((strategy: GrowthStrategy) => (
              <div key={strategy.id} className="border rounded-lg p-6">
                <div className="mb-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-semibold">{strategy.title}</h3>
                    <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                      {strategy.category}
                    </span>
                  </div>
                  <p className="text-gray-600">{strategy.description}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium mb-2">Action Items</h4>
                    <ul className="space-y-1">
                      {strategy.actions.map((action, index) => (
                        <li key={index} className="flex items-start">
                          <span className="text-green-500 mr-2">✓</span>
                          <span className="text-sm text-gray-700">{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <div className="space-y-3">
                      <div>
                        <span className="font-medium text-sm">Timeframe:</span>
                        <span className="ml-2 text-sm text-gray-600">{strategy.timeframe}</span>
                      </div>
                      <div>
                        <span className="font-medium text-sm">Expected Impact:</span>
                        <span className="ml-2 text-sm text-green-600">{strategy.expectedImpact}</span>
                      </div>
                      <div>
                        <span className="font-medium text-sm">Resources Needed:</span>
                        <div className="mt-1">
                          {strategy.resources.map((resource, index) => (
                            <span key={index} className="inline-block bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs mr-1 mb-1">
                              {resource}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}