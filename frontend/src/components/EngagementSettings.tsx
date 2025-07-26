import { useState, useEffect } from 'react'
import { apiClient } from '../lib/api'

interface EngagementRules {
  autoLike: {
    enabled: boolean
    targetHashtags: string[]
    maxLikesPerHour: number
    likeProbability?: number
  }
  autoComment: {
    enabled: boolean
    templates: string[]
    maxCommentsPerHour: number
    commentProbability?: number
  }
  autoFollow: {
    enabled: boolean
    maxFollowsPerHour: number
    followProbability?: number
    targetAccounts?: string[]
  }
  autoUnfollow: {
    enabled: boolean
    maxUnfollowsPerHour: number
    unfollowAfterDays: number
  }
  safetyLimits: {
    maxActionsPerHour: number
    minDelayBetweenActions: number
    respectBusinessHours: boolean
  }
}

interface EngagementSettingsProps {
  brandId: string
}

export default function EngagementSettings({ brandId }: EngagementSettingsProps) {
  const [rules, setRules] = useState<EngagementRules>({
    autoLike: {
      enabled: false,
      targetHashtags: [],
      maxLikesPerHour: 30
    },
    autoComment: {
      enabled: false,
      templates: [],
      maxCommentsPerHour: 10
    },
    autoFollow: {
      enabled: false,
      maxFollowsPerHour: 5
    },
    autoUnfollow: {
      enabled: false,
      maxUnfollowsPerHour: 5,
      unfollowAfterDays: 7
    },
    safetyLimits: {
      maxActionsPerHour: 50,
      minDelayBetweenActions: 60,
      respectBusinessHours: true
    }
  })
  
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [newHashtag, setNewHashtag] = useState('')
  const [newComment, setNewComment] = useState('')

  useEffect(() => {
    loadRules()
  }, [brandId])

  const loadRules = async () => {
    setLoading(true)
    setError('')
    
    try {
      const response = await apiClient.get<{rules: EngagementRules}>(`/engagement/rules/${brandId}`)
      if (response.rules) {
        setRules(response.rules)
      }
    } catch (err) {
      setError('Failed to load engagement rules')
    } finally {
      setLoading(false)
    }
  }

  const saveRules = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    
    try {
      await apiClient.post('/engagement/rules', {
        brandId,
        rules
      })
      setSuccess('Engagement rules saved successfully!')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to save engagement rules')
    } finally {
      setSaving(false)
    }
  }

  const addHashtag = () => {
    if (newHashtag.trim() && !rules.autoLike.targetHashtags.includes(newHashtag.trim())) {
      setRules(prev => ({
        ...prev,
        autoLike: {
          ...prev.autoLike,
          targetHashtags: [...prev.autoLike.targetHashtags, newHashtag.trim()]
        }
      }))
      setNewHashtag('')
    }
  }

  const removeHashtag = (hashtag: string) => {
    setRules(prev => ({
      ...prev,
      autoLike: {
        ...prev.autoLike,
        targetHashtags: prev.autoLike.targetHashtags.filter(h => h !== hashtag)
      }
    }))
  }

  const addCommentTemplate = () => {
    if (newComment.trim() && !rules.autoComment.templates.includes(newComment.trim())) {
      setRules(prev => ({
        ...prev,
        autoComment: {
          ...prev.autoComment,
          templates: [...prev.autoComment.templates, newComment.trim()]
        }
      }))
      setNewComment('')
    }
  }

  const removeCommentTemplate = (comment: string) => {
    setRules(prev => ({
      ...prev,
      autoComment: {
        ...prev.autoComment,
        templates: prev.autoComment.templates.filter(c => c !== comment)
      }
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2">Loading engagement settings...</span>
      </div>
    )
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h3 className="text-lg font-semibold mb-6">Engagement Automation Settings</h3>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
          {success}
        </div>
      )}

      <div className="space-y-8">
        {/* Auto Like Settings */}
        <div className="border-b pb-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-md font-medium">Auto Like</h4>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={rules.autoLike.enabled}
                onChange={(e) => setRules(prev => ({
                  ...prev,
                  autoLike: { ...prev.autoLike, enabled: e.target.checked }
                }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm">Enable</span>
            </label>
          </div>
          
          {rules.autoLike.enabled && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Likes per Hour (limit: 60)
                </label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={rules.autoLike.maxLikesPerHour}
                  onChange={(e) => setRules(prev => ({
                    ...prev,
                    autoLike: { ...prev.autoLike, maxLikesPerHour: parseInt(e.target.value) || 1 }
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Target Hashtags
                </label>
                <div className="flex space-x-2 mb-2">
                  <input
                    type="text"
                    placeholder="#photography"
                    value={newHashtag}
                    onChange={(e) => setNewHashtag(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addHashtag()}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={addHashtag}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {rules.autoLike.targetHashtags.map((hashtag, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-800"
                    >
                      {hashtag}
                      <button
                        onClick={() => removeHashtag(hashtag)}
                        className="ml-2 text-blue-600 hover:text-blue-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Auto Comment Settings */}
        <div className="border-b pb-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-md font-medium">Auto Comment</h4>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={rules.autoComment.enabled}
                onChange={(e) => setRules(prev => ({
                  ...prev,
                  autoComment: { ...prev.autoComment, enabled: e.target.checked }
                }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm">Enable</span>
            </label>
          </div>
          
          {rules.autoComment.enabled && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Comments per Hour (limit: 20)
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={rules.autoComment.maxCommentsPerHour}
                  onChange={(e) => setRules(prev => ({
                    ...prev,
                    autoComment: { ...prev.autoComment, maxCommentsPerHour: parseInt(e.target.value) || 1 }
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Comment Templates
                </label>
                <div className="flex space-x-2 mb-2">
                  <input
                    type="text"
                    placeholder="Great shot! 📸"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addCommentTemplate()}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={addCommentTemplate}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Add
                  </button>
                </div>
                <div className="space-y-2">
                  {rules.autoComment.templates.map((template, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                    >
                      <span className="text-sm">{template}</span>
                      <button
                        onClick={() => removeCommentTemplate(template)}
                        className="text-red-600 hover:text-red-800"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Auto Follow Settings */}
        <div className="border-b pb-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-md font-medium">Auto Follow</h4>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={rules.autoFollow.enabled}
                onChange={(e) => setRules(prev => ({
                  ...prev,
                  autoFollow: { ...prev.autoFollow, enabled: e.target.checked }
                }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm">Enable</span>
            </label>
          </div>
          
          {rules.autoFollow.enabled && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Follows per Hour (limit: 15)
              </label>
              <input
                type="number"
                min="1"
                max="15"
                value={rules.autoFollow.maxFollowsPerHour}
                onChange={(e) => setRules(prev => ({
                  ...prev,
                  autoFollow: { ...prev.autoFollow, maxFollowsPerHour: parseInt(e.target.value) || 1 }
                }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
        </div>

        {/* Safety Limits */}
        <div>
          <h4 className="text-md font-medium mb-4">Safety Limits</h4>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Total Actions per Hour (limit: 80)
              </label>
              <input
                type="number"
                min="1"
                max="80"
                value={rules.safetyLimits.maxActionsPerHour}
                onChange={(e) => setRules(prev => ({
                  ...prev,
                  safetyLimits: { ...prev.safetyLimits, maxActionsPerHour: parseInt(e.target.value) || 1 }
                }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Minimum Delay Between Actions (seconds)
              </label>
              <input
                type="number"
                min="30"
                value={rules.safetyLimits.minDelayBetweenActions}
                onChange={(e) => setRules(prev => ({
                  ...prev,
                  safetyLimits: { ...prev.safetyLimits, minDelayBetweenActions: parseInt(e.target.value) || 30 }
                }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={rules.safetyLimits.respectBusinessHours}
                onChange={(e) => setRules(prev => ({
                  ...prev,
                  safetyLimits: { ...prev.safetyLimits, respectBusinessHours: e.target.checked }
                }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm">Only engage during business hours (9 AM - 6 PM)</span>
            </label>
          </div>
        </div>
      </div>

      <div className="mt-8 flex justify-end">
        <button
          onClick={saveRules}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}