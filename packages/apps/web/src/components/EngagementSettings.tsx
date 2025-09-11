import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../lib/api';

interface EngagementRules {
  autoLike: {
    enabled: boolean;
    targetHashtags: string[];
    maxLikesPerHour: number;
    likeProbability?: number;
  };
  autoComment: {
    enabled: boolean;
    templates: string[];
    maxCommentsPerHour: number;
    commentProbability?: number;
  };
  autoFollow: {
    enabled: boolean;
    maxFollowsPerHour: number;
    followProbability?: number;
    targetAccounts?: string[];
  };
  autoUnfollow: {
    enabled: boolean;
    maxUnfollowsPerHour: number;
    unfollowAfterDays: number;
  };
  safetyLimits: {
    maxActionsPerHour: number;
    minDelayBetweenActions: number;
    respectBusinessHours: boolean;
  };
}

interface EngagementSettingsProps {
  brandId: string;
}

export default function EngagementSettings({ brandId }: EngagementSettingsProps) {
  const [rules, setRules] = useState<EngagementRules>({
    autoLike: {
      enabled: false,
      targetHashtags: [],
      maxLikesPerHour: 30,
    },
    autoComment: {
      enabled: false,
      templates: [],
      maxCommentsPerHour: 10,
    },
    autoFollow: {
      enabled: false,
      maxFollowsPerHour: 5,
    },
    autoUnfollow: {
      enabled: false,
      maxUnfollowsPerHour: 5,
      unfollowAfterDays: 7,
    },
    safetyLimits: {
      maxActionsPerHour: 50,
      minDelayBetweenActions: 60,
      respectBusinessHours: true,
    },
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newHashtag, setNewHashtag] = useState('');
  const [newComment, setNewComment] = useState('');

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get<{ rules: EngagementRules }>(
        `/api/engagement/rules/${brandId}`
      );
      if (response.rules) {
        setRules(response.rules);
      }
    } catch {
      setError('Failed to load engagement rules');
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  // loadRules moved above with useCallback

  const saveRules = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await apiClient.post('/api/engagement/rules', {
        brandId,
        rules,
      });
      setSuccess('Engagement rules saved successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'message' in err) {
        setError((err as any).message || 'Failed to save engagement rules');
      } else {
        setError('Failed to save engagement rules');
      }
    } finally {
      setSaving(false);
    }
  };

  const addHashtag = () => {
    if (newHashtag.trim() && !rules.autoLike.targetHashtags.includes(newHashtag.trim())) {
      setRules((prev) => ({
        ...prev,
        autoLike: {
          ...prev.autoLike,
          targetHashtags: [...prev.autoLike.targetHashtags, newHashtag.trim()],
        },
      }));
      setNewHashtag('');
    }
  };

  const removeHashtag = (hashtag: string) => {
    setRules((prev) => ({
      ...prev,
      autoLike: {
        ...prev.autoLike,
        targetHashtags: prev.autoLike.targetHashtags.filter((h) => h !== hashtag),
      },
    }));
  };

  const addCommentTemplate = () => {
    if (newComment.trim() && !rules.autoComment.templates.includes(newComment.trim())) {
      setRules((prev) => ({
        ...prev,
        autoComment: {
          ...prev.autoComment,
          templates: [...prev.autoComment.templates, newComment.trim()],
        },
      }));
      setNewComment('');
    }
  };

  const removeCommentTemplate = (comment: string) => {
    setRules((prev) => ({
      ...prev,
      autoComment: {
        ...prev.autoComment,
        templates: prev.autoComment.templates.filter((c) => c !== comment),
      },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
        <span className="ml-2">Loading engagement settings...</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-white p-6 shadow-md">
      <h3 className="mb-6 text-lg font-semibold">Engagement Automation Settings</h3>

      {error && (
        <div className="mb-4 rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded border border-green-400 bg-green-100 px-4 py-3 text-green-700">
          {success}
        </div>
      )}

      <div className="space-y-8">
        {/* Auto Like Settings */}
        <div className="border-b pb-6">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-md font-medium">Auto Like</h4>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={rules.autoLike.enabled}
                onChange={(e) =>
                  setRules((prev) => ({
                    ...prev,
                    autoLike: { ...prev.autoLike, enabled: e.target.checked },
                  }))
                }
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm">Enable</span>
            </label>
          </div>

          {rules.autoLike.enabled && (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Max Likes per Hour (limit: 60)
                </label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={rules.autoLike.maxLikesPerHour}
                  onChange={(e) =>
                    setRules((prev) => ({
                      ...prev,
                      autoLike: {
                        ...prev.autoLike,
                        maxLikesPerHour: parseInt(e.target.value) || 1,
                      },
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Target Hashtags
                </label>
                <div className="mb-2 flex space-x-2">
                  <input
                    type="text"
                    placeholder="#photography"
                    value={newHashtag}
                    onChange={(e) => setNewHashtag(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addHashtag()}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={addHashtag}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {rules.autoLike.targetHashtags.map((hashtag, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800"
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
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-md font-medium">Auto Comment</h4>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={rules.autoComment.enabled}
                onChange={(e) =>
                  setRules((prev) => ({
                    ...prev,
                    autoComment: {
                      ...prev.autoComment,
                      enabled: e.target.checked,
                    },
                  }))
                }
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm">Enable</span>
            </label>
          </div>

          {rules.autoComment.enabled && (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Max Comments per Hour (limit: 20)
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={rules.autoComment.maxCommentsPerHour}
                  onChange={(e) =>
                    setRules((prev) => ({
                      ...prev,
                      autoComment: {
                        ...prev.autoComment,
                        maxCommentsPerHour: parseInt(e.target.value) || 1,
                      },
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Comment Templates
                </label>
                <div className="mb-2 flex space-x-2">
                  <input
                    type="text"
                    placeholder="Great shot! 📸"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addCommentTemplate()}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={addCommentTemplate}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                  >
                    Add
                  </button>
                </div>
                <div className="space-y-2">
                  {rules.autoComment.templates.map((template, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between rounded-lg bg-gray-50 p-2"
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
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-md font-medium">Auto Follow</h4>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={rules.autoFollow.enabled}
                onChange={(e) =>
                  setRules((prev) => ({
                    ...prev,
                    autoFollow: {
                      ...prev.autoFollow,
                      enabled: e.target.checked,
                    },
                  }))
                }
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm">Enable</span>
            </label>
          </div>

          {rules.autoFollow.enabled && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Max Follows per Hour (limit: 15)
              </label>
              <input
                type="number"
                min="1"
                max="15"
                value={rules.autoFollow.maxFollowsPerHour}
                onChange={(e) =>
                  setRules((prev) => ({
                    ...prev,
                    autoFollow: {
                      ...prev.autoFollow,
                      maxFollowsPerHour: parseInt(e.target.value) || 1,
                    },
                  }))
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
        </div>

        {/* Safety Limits */}
        <div>
          <h4 className="text-md mb-4 font-medium">Safety Limits</h4>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Max Total Actions per Hour (limit: 80)
              </label>
              <input
                type="number"
                min="1"
                max="80"
                value={rules.safetyLimits.maxActionsPerHour}
                onChange={(e) =>
                  setRules((prev) => ({
                    ...prev,
                    safetyLimits: {
                      ...prev.safetyLimits,
                      maxActionsPerHour: parseInt(e.target.value) || 1,
                    },
                  }))
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Minimum Delay Between Actions (seconds)
              </label>
              <input
                type="number"
                min="30"
                value={rules.safetyLimits.minDelayBetweenActions}
                onChange={(e) =>
                  setRules((prev) => ({
                    ...prev,
                    safetyLimits: {
                      ...prev.safetyLimits,
                      minDelayBetweenActions: parseInt(e.target.value) || 30,
                    },
                  }))
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <label className="flex items-center">
              <input
                type="checkbox"
                checked={rules.safetyLimits.respectBusinessHours}
                onChange={(e) =>
                  setRules((prev) => ({
                    ...prev,
                    safetyLimits: {
                      ...prev.safetyLimits,
                      respectBusinessHours: e.target.checked,
                    },
                  }))
                }
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
          className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
