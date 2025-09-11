import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { PageHeader } from '@/components/PageHeader';
import { useBrandStore } from '../stores/brandStore';

// Types for API responses
type HashtagResults = {
  optimizedHashtags: string[];
  relevanceScore: number;
  analytics: {
    competitionLevel: 'low' | 'medium' | 'high';
  };
  suggestions: string[];
};

type CompetitorInsight = {
  handle: string;
  followers: number;
  engagementRate: number;
  postFrequency: number;
  topHashtags: string[];
};

type CompetitorResults = {
  competitorInsights: CompetitorInsight[];
  recommendations: string[];
};

type ContentSuggestion = {
  title: string;
  contentType: 'post' | 'story' | 'reel';
  difficulty: 'easy' | 'medium' | 'hard';
  description: string;
  suggestedHashtags: string[];
  resources: string[];
  estimatedEngagement: number;
};

type ScheduleResults = {
  recommendedTimes: {
    day: string;
    time: string;
    engagement: number;
    reach: number;
  }[];
  frequency: {
    optimal: string;
    daily: number;
  };
  insights: string[];
};

export function AIFeatures() {
  const { selectedBrand } = useBrandStore();

  const [activeTab, setActiveTab] = useState<'hashtags' | 'competitors' | 'content' | 'schedule'>(
    'hashtags'
  );

  // Hashtag optimization state
  const [content, setContent] = useState<string>('');
  const [currentHashtags, setCurrentHashtags] = useState<string>('');
  const [hashtagResults, setHashtagResults] = useState<HashtagResults | null>(null);

  // Competitor analysis state
  const [competitors, setCompetitors] = useState<string>('');
  const [competitorResults, setCompetitorResults] = useState<CompetitorResults | null>(null);

  // Content suggestions state
  const [context, setContext] = useState<string>('');
  const [contentType, setContentType] = useState<'post' | 'story' | 'reel'>('post');
  const [contentSuggestions, setContentSuggestions] = useState<ContentSuggestion[] | null>(null);

  // Schedule optimization state
  const [scheduleResults, setScheduleResults] = useState<ScheduleResults | null>(null);

  const hashtagMutation = useMutation<
    HashtagResults,
    unknown,
    { brandId: string; content: string; currentHashtags: string[] }
  >({
    mutationFn: async (data) => {
      const res = await apiClient.post('/ai/hashtags/optimize', data);
      return res as HashtagResults;
    },
    onSuccess: (data) => setHashtagResults(data),
  });

  const competitorMutation = useMutation<
    CompetitorResults,
    unknown,
    { brandId: string; competitors: string[] }
  >({
    mutationFn: async (data) => {
      const res = (await apiClient.post('/ai/competitors/analyze', data)) as {
        analysis: CompetitorResults;
      };
      return res.analysis;
    },
    onSuccess: (data) => setCompetitorResults(data),
  });

  const contentMutation = useMutation<
    ContentSuggestion[],
    unknown,
    { brandId: string; context: string; contentType: 'post' | 'story' | 'reel' }
  >({
    mutationFn: async (data) => {
      const res = (await apiClient.post('/ai/content/suggestions', data)) as {
        suggestions: ContentSuggestion[];
      };
      return res.suggestions;
    },
    onSuccess: (data) => setContentSuggestions(data),
  });

  const scheduleMutation = useMutation<ScheduleResults, unknown, { brandId: string }>({
    mutationFn: async (data) => {
      const res = (await apiClient.post('/ai/schedule/optimize', data)) as {
        optimizedSchedule: ScheduleResults;
      };
      return res.optimizedSchedule;
    },
    onSuccess: (data) => setScheduleResults(data),
  });

  const handleHashtagOptimization = () => {
    if (!selectedBrand || !content) return;
    const hashtags = currentHashtags
      .split(',')
      .map((h) => h.trim())
      .filter((h) => h);
    hashtagMutation.mutate({
      brandId: selectedBrand.id,
      content,
      currentHashtags: hashtags,
    });
  };

  const handleCompetitorAnalysis = () => {
    if (!selectedBrand || !competitors) return;
    const competitorList = competitors
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c);
    competitorMutation.mutate({
      brandId: selectedBrand.id,
      competitors: competitorList,
    });
  };

  const handleContentSuggestions = () => {
    if (!selectedBrand || !context) return;
    contentMutation.mutate({
      brandId: selectedBrand.id,
      context,
      contentType,
    });
  };

  const handleScheduleOptimization = () => {
    if (!selectedBrand) return;
    scheduleMutation.mutate({
      brandId: selectedBrand.id,
    });
  };

  if (!selectedBrand) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-gray-500">Please select a brand to access AI features</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="AI-Powered Features" />

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'hashtags', name: 'Hashtag Optimizer' },
            { id: 'competitors', name: 'Competitor Analysis' },
            { id: 'content', name: 'Content Ideas' },
            { id: 'schedule', name: 'Schedule Optimizer' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`border-b-2 px-1 py-2 text-sm font-medium ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Hashtag Optimizer */}
      {activeTab === 'hashtags' && (
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-xl font-semibold">AI Hashtag Optimizer</h2>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Content Description
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Describe your content (e.g., 'Beautiful sunset photography session')"
                className="h-24 w-full rounded-md border px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Current Hashtags (comma-separated)
              </label>
              <input
                type="text"
                value={currentHashtags}
                onChange={(e) => setCurrentHashtags(e.target.value)}
                placeholder="#photography, #sunset"
                className="w-full rounded-md border px-3 py-2"
              />
            </div>

            <button
              onClick={handleHashtagOptimization}
              disabled={hashtagMutation.isPending || !content}
              className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {hashtagMutation.isPending ? 'Optimizing...' : 'Optimize Hashtags'}
            </button>
          </div>

          {hashtagResults && (
            <div className="mt-6 space-y-4">
              <div>
                <h3 className="mb-2 font-medium text-gray-900">Optimized Hashtags</h3>
                <div className="flex flex-wrap gap-2">
                  {hashtagResults.optimizedHashtags.map((tag, index) => (
                    <span
                      key={index}
                      className="rounded bg-blue-100 px-2 py-1 text-sm text-blue-800"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded bg-gray-50 p-4">
                  <h4 className="mb-2 font-medium">Relevance Score</h4>
                  <p className="text-2xl font-bold text-green-600">
                    {hashtagResults.relevanceScore}%
                  </p>
                </div>
                <div className="rounded bg-gray-50 p-4">
                  <h4 className="mb-2 font-medium">Competition Level</h4>
                  <p
                    className={`text-lg font-semibold ${
                      hashtagResults.analytics.competitionLevel === 'low'
                        ? 'text-green-600'
                        : hashtagResults.analytics.competitionLevel === 'medium'
                          ? 'text-yellow-600'
                          : 'text-red-600'
                    }`}
                  >
                    {hashtagResults.analytics.competitionLevel.toUpperCase()}
                  </p>
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-medium">Additional Suggestions</h4>
                <div className="flex flex-wrap gap-2">
                  {hashtagResults.suggestions.map((tag, index) => (
                    <span
                      key={index}
                      className="rounded bg-green-100 px-2 py-1 text-sm text-green-800"
                    >
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
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-xl font-semibold">Competitor Analysis</h2>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Competitor Handles (comma-separated)
              </label>
              <input
                type="text"
                value={competitors}
                onChange={(e) => setCompetitors(e.target.value)}
                placeholder="@competitor1, @competitor2"
                className="w-full rounded-md border px-3 py-2"
              />
            </div>

            <button
              onClick={handleCompetitorAnalysis}
              disabled={competitorMutation.isPending || !competitors}
              className="rounded-md bg-purple-600 px-4 py-2 text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {competitorMutation.isPending ? 'Analyzing...' : 'Analyze Competitors'}
            </button>
          </div>

          {competitorResults && (
            <div className="mt-6 space-y-6">
              <div>
                <h3 className="mb-4 font-medium text-gray-900">Competitor Insights</h3>
                <div className="space-y-4">
                  {competitorResults.competitorInsights.map((comp, index) => (
                    <div key={index} className="rounded-lg border p-4">
                      <h4 className="font-semibold">{comp.handle}</h4>
                      <div className="mt-2 grid grid-cols-2 gap-4 md:grid-cols-4">
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
                          <div className="mt-1 flex flex-wrap gap-1">
                            {comp.topHashtags.slice(0, 3).map((tag, i) => (
                              <span key={i} className="rounded bg-gray-100 px-1 text-xs">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-3 font-medium text-gray-900">Recommendations</h3>
                <ul className="space-y-2">
                  {competitorResults.recommendations.map((rec, index) => (
                    <li key={index} className="flex items-start">
                      <span className="mr-2 text-blue-500">•</span>
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
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-xl font-semibold">AI Content Suggestions</h2>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Context/Theme</label>
              <input
                type="text"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="e.g., holiday season, spring, new product launch"
                className="w-full rounded-md border px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Content Type</label>
              <select
                value={contentType}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setContentType(e.target.value as 'post' | 'story' | 'reel')
                }
                className="w-full rounded-md border px-3 py-2"
              >
                <option value="post">Post</option>
                <option value="story">Story</option>
                <option value="reel">Reel</option>
              </select>
            </div>

            <button
              onClick={handleContentSuggestions}
              disabled={contentMutation.isPending || !context}
              className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {contentMutation.isPending ? 'Generating...' : 'Generate Ideas'}
            </button>
          </div>

          {contentSuggestions && (
            <div className="mt-6 space-y-4">
              {contentSuggestions.map((suggestion, index) => (
                <div key={index} className="rounded-lg border p-4">
                  <div className="mb-2 flex items-start justify-between">
                    <h3 className="font-semibold">{suggestion.title}</h3>
                    <div className="flex space-x-2">
                      <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-800">
                        {suggestion.contentType}
                      </span>
                      <span
                        className={`rounded px-2 py-1 text-xs ${
                          suggestion.difficulty === 'easy'
                            ? 'bg-green-100 text-green-800'
                            : suggestion.difficulty === 'medium'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {suggestion.difficulty}
                      </span>
                    </div>
                  </div>
                  <p className="mb-3 text-gray-600">{suggestion.description}</p>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="mb-2 text-sm font-medium">Suggested Hashtags</h4>
                      <div className="flex flex-wrap gap-1">
                        {suggestion.suggestedHashtags.map((tag, i) => (
                          <span
                            key={i}
                            className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="mb-2 text-sm font-medium">Resources Needed</h4>
                      <ul className="text-sm text-gray-600">
                        {suggestion.resources.map((resource, i) => (
                          <li key={i}>• {resource}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-3 text-sm">
                    <span className="font-medium">Estimated Engagement: </span>
                    <span className="font-semibold text-green-600">
                      {suggestion.estimatedEngagement}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Schedule Optimizer */}
      {activeTab === 'schedule' && (
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-xl font-semibold">AI Schedule Optimizer</h2>

          <div className="space-y-4">
            <button
              onClick={handleScheduleOptimization}
              disabled={scheduleMutation.isPending}
              className="rounded-md bg-orange-600 px-4 py-2 text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {scheduleMutation.isPending ? 'Optimizing...' : 'Optimize Schedule'}
            </button>
          </div>

          {scheduleResults && (
            <div className="mt-6 space-y-6">
              <div>
                <h3 className="mb-4 font-medium text-gray-900">Optimal Posting Times</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {scheduleResults.recommendedTimes.map((time, index) => (
                    <div key={index} className="rounded border p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{time.day}</span>
                        <span className="font-semibold text-blue-600">{time.time}</span>
                      </div>
                      <div className="mt-1 text-sm text-gray-600">
                        Engagement: {time.engagement}% | Reach: {time.reach.toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-3 font-medium text-gray-900">Frequency Recommendations</h3>
                <div className="rounded bg-blue-50 p-4">
                  <p className="text-lg font-semibold text-blue-800">
                    {scheduleResults.frequency.optimal}
                  </p>
                  <p className="mt-1 text-sm text-blue-600">
                    Current average: {scheduleResults.frequency.daily} posts/day
                  </p>
                </div>
              </div>

              <div>
                <h3 className="mb-3 font-medium text-gray-900">AI Insights</h3>
                <ul className="space-y-2">
                  {scheduleResults.insights.map((insight, index) => (
                    <li key={index} className="flex items-start">
                      <span className="mr-2 text-orange-500">💡</span>
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
  );
}
