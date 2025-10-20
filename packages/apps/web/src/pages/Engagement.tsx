import { useState, useEffect } from 'react';
import { brand as brandApi, httpGet, httpPost, type Brand } from '../lib/api';
import EngagementSettings from '../components/EngagementSettings';

interface EngagementStatus {
  configured: boolean;
  active: boolean;
  instagramConnected: boolean;
  canStart: boolean;
  canStop: boolean;
}

interface EngagementStats {
  totalActions: number;
  likes: number;
  comments: number;
  follows: number;
  successRate: number;
  averageActionsPerDay: number;
}

export default function Engagement() {
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [brands, setBrands] = useState<Brand[]>([]);
  const [status, setStatus] = useState<EngagementStatus | null>(null);
  const [stats, setStats] = useState<EngagementStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Initial brands load on mount

  useEffect(() => {
    loadBrands();
  }, []);

  // Load engagement data when brand changes

  useEffect(() => {
    if (selectedBrandId) {
      loadEngagementData();
    }
  }, [selectedBrandId]);

  const loadBrands = async () => {
    try {
      const response = await brandApi.getBrands();
      setBrands(response.brands);
      if (response.brands.length > 0) {
        setSelectedBrandId(response.brands[0].id);
      }
    } catch {
      setError('Failed to load brands');
    }
  };

  const loadEngagementData = async () => {
    if (!selectedBrandId) return;

    setLoading(true);
    setError('');

    try {
      const [statusResponse, statsResponse] = await Promise.all([
        httpGet(`/api/engagement/status/${selectedBrandId}`),
        httpGet(`/api/engagement/stats/${selectedBrandId}?days=7`),
      ] as any);

      setStatus(statusResponse.status);
      setStats(statsResponse.stats);
    } catch {
      setError('Failed to load engagement data');
    } finally {
      setLoading(false);
    }
  };

  const handleStartEngagement = async () => {
    if (!selectedBrandId) return;

    setActionLoading(true);
    setError('');

    try {
      await httpPost(`/api/engagement/start/${selectedBrandId}`);
      await loadEngagementData(); // Refresh status
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to start engagement automation');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStopEngagement = async () => {
    if (!selectedBrandId) return;

    setActionLoading(true);
    setError('');

    try {
      await httpPost(`/api/engagement/stop/${selectedBrandId}`);
      await loadEngagementData(); // Refresh status
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to stop engagement automation');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold text-gray-900">Engagement Automation</h1>
          <p className="text-gray-600">
            Automate likes, comments, and follows with smart safety controls
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
            {error}
          </div>
        )}

        <div className="mb-6">
          <select
            value={selectedBrandId}
            onChange={(e) => setSelectedBrandId(e.target.value)}
            className="rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a brand</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </div>

        {selectedBrandId && (
          <>
            {/* Status and Control Panel */}
            <div className="mb-8 rounded-lg bg-white p-6 shadow-md">
              <h3 className="mb-4 text-lg font-semibold">Automation Status</h3>

              {loading ? (
                <div className="flex items-center">
                  <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-blue-600"></div>
                  <span className="ml-2">Loading status...</span>
                </div>
              ) : status ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="flex items-center space-x-3">
                      <div
                        className={`h-3 w-3 rounded-full ${status.configured ? 'bg-green-500' : 'bg-red-500'}`}
                      ></div>
                      <span className="text-sm">
                        Rules {status.configured ? 'Configured' : 'Not Configured'}
                      </span>
                    </div>

                    <div className="flex items-center space-x-3">
                      <div
                        className={`h-3 w-3 rounded-full ${status.instagramConnected ? 'bg-green-500' : 'bg-red-500'}`}
                      ></div>
                      <span className="text-sm">
                        Instagram {status.instagramConnected ? 'Connected' : 'Not Connected'}
                      </span>
                    </div>

                    <div className="flex items-center space-x-3">
                      <div
                        className={`h-3 w-3 rounded-full ${status.active ? 'bg-green-500' : 'bg-gray-400'}`}
                      ></div>
                      <span className="text-sm">
                        Automation {status.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>

                  <div className="flex space-x-3">
                    {status.canStart && (
                      <button
                        onClick={handleStartEngagement}
                        disabled={actionLoading}
                        className="rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {actionLoading ? 'Starting...' : 'Start Automation'}
                      </button>
                    )}

                    {status.canStop && (
                      <button
                        onClick={handleStopEngagement}
                        disabled={actionLoading}
                        className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {actionLoading ? 'Stopping...' : 'Stop Automation'}
                      </button>
                    )}
                  </div>

                  {!status.instagramConnected && (
                    <div className="rounded border border-yellow-400 bg-yellow-100 px-4 py-3 text-yellow-700">
                      <p className="text-sm">
                        Connect your Instagram account to enable engagement automation.
                        <a href="/analytics" className="ml-1 underline">
                          Go to Analytics
                        </a>{' '}
                        to connect.
                      </p>
                    </div>
                  )}

                  {!status.configured && status.instagramConnected && (
                    <div className="rounded border border-blue-400 bg-blue-100 px-4 py-3 text-blue-700">
                      <p className="text-sm">
                        Configure your engagement rules below to get started.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Statistics */}
            {stats && (
              <div className="mb-8 rounded-lg bg-white p-6 shadow-md">
                <h3 className="mb-4 text-lg font-semibold">Engagement Statistics (Last 7 Days)</h3>

                <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{stats.totalActions}</div>
                    <div className="text-sm text-gray-600">Total Actions</div>
                  </div>

                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{stats.likes}</div>
                    <div className="text-sm text-gray-600">Likes</div>
                  </div>

                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">{stats.comments}</div>
                    <div className="text-sm text-gray-600">Comments</div>
                  </div>

                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">{stats.follows}</div>
                    <div className="text-sm text-gray-600">Follows</div>
                  </div>
                </div>

                <div className="mt-6 border-t border-gray-200 pt-6">
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="text-center">
                      <div className="text-xl font-semibold text-gray-900">
                        {stats.successRate.toFixed(1)}%
                      </div>
                      <div className="text-sm text-gray-600">Success Rate</div>
                    </div>

                    <div className="text-center">
                      <div className="text-xl font-semibold text-gray-900">
                        {stats.averageActionsPerDay.toFixed(1)}
                      </div>
                      <div className="text-sm text-gray-600">Avg. Actions/Day</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Engagement Settings */}
            <EngagementSettings brandId={selectedBrandId} />
          </>
        )}

        {!selectedBrandId && brands.length === 0 && (
          <div className="py-12 text-center">
            <div className="mb-4 text-gray-400">
              <svg
                className="mx-auto h-12 w-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-4m-5 0H3m2 0h3M9 7h6m-6 4h6m-6 4h6"
                />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-medium text-gray-900">No brands found</h3>
            <p className="text-gray-500">
              Create a brand first to configure engagement automation.
            </p>
            <a
              href="/brands"
              className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              Create Brand
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
