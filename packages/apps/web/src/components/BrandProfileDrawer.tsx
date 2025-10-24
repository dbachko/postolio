import { useEffect, useState } from 'react';
import { brand as brandApi } from '@/lib/api';

interface Props {
  brandId: string | null;
  onClose: () => void;
}

export function BrandProfileDrawer({ brandId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reRunLoading, setReRunLoading] = useState(false);
  const [reRunMessage, setReRunMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<{
    brandId: string;
    version: number;
    createdAt: string;
    text?: { tone?: string[] };
    topics?: Array<{ value: string; count: number }>;
    visual?: { palette?: string[]; motifs?: string[]; composition?: string[] };
    overlays?: Array<{
      type: 'SEASONAL' | 'TRENDING' | 'CAMPAIGN';
      label?: string;
      createdAt?: string;
      expiresAt?: string;
      text?: { tone?: string[] };
      visual?: { palette?: string[] };
      topics?: Array<{ value: string; count: number }>;
    }>;
    anchors?: { visual?: { palette?: string[] } };
  } | null>(null);
  const [freezeCore, setFreezeCore] = useState<boolean>(false);
  const [freezeLoading, setFreezeLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!brandId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await brandApi.getBrandAnalysisProfile(brandId);
        if ('error' in res) {
          setError(res.error || 'No profile found');
          setProfile(null);
        } else {
          setProfile(res);
        }
        try {
          const fz = await brandApi.getFreezeCore(brandId);
          setFreezeCore(Boolean(fz?.freezeCore));
        } catch (e: any) {
          console.warn('Failed to load freezeCore', e?.message || e);
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [brandId]);

  async function toggleFreeze() {
    if (!brandId) return;
    setFreezeLoading(true);
    try {
      const next = !freezeCore;
      await brandApi.setFreezeCore(brandId, next);
      setFreezeCore(next);
    } catch (e: any) {
      alert(e?.message || 'Failed to update freeze setting');
    } finally {
      setFreezeLoading(false);
    }
  }

  async function handleReRun() {
    if (!brandId) return;
    setReRunLoading(true);
    setReRunMessage(null);
    try {
      const res = await brandApi.startBrandAnalysis(brandId, { force: true, maxPosts: 20 });
      if (res && res.status === 'accepted') {
        setReRunMessage('Analysis requested. It will refresh shortly.');
      } else {
        setReRunMessage('Requested. Awaiting update...');
      }
    } catch (e: any) {
      setReRunMessage(e?.message || 'Failed to request analysis');
    } finally {
      setReRunLoading(false);
    }
  }

  const open = !!brandId;
  return (
    <div
      className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'} ${
        open ? 'opacity-100' : 'opacity-0'
      } transition-opacity`}
      aria-hidden={!open}
    >
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        role="button"
        aria-label="Close overlay"
      />
      <div className={`absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium text-gray-900">Brand Profile</h3>
          <div className="flex items-center gap-2">
            {brandId && (
              <button
                onClick={handleReRun}
                disabled={reRunLoading}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {reRunLoading ? 'Requesting…' : 'Re-run Analysis'}
              </button>
            )}
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              Close
            </button>
          </div>
        </div>
        <div className="max-h-[calc(100%-48px)] overflow-y-auto p-4">
          {reRunMessage && (
            <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-700">
              {reRunMessage}
            </div>
          )}
          {loading && <div className="text-sm text-gray-600">Loading…</div>}
          {error && <div className="text-sm text-red-600">{error}</div>}
          {!loading && !error && profile && (
            <div className="space-y-4 text-sm text-gray-800">
              <div>
                <div className="text-xs text-gray-500">Version</div>
                <div>
                  {profile.version} · {new Date(profile.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-gray-50 p-2">
                <div>
                  <div className="text-xs text-gray-500">Core Profile Updates</div>
                  <div className="text-xs text-gray-700">
                    {freezeCore ? 'Frozen (requires manual approval)' : 'Auto-updates allowed'}
                  </div>
                </div>
                <button
                  onClick={toggleFreeze}
                  disabled={freezeLoading}
                  className={`rounded px-3 py-1 text-xs ${
                    freezeCore
                      ? 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                      : 'border border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                  } disabled:opacity-50`}
                >
                  {freezeCore
                    ? freezeLoading
                      ? 'Unfreezing…'
                      : 'Unfreeze'
                    : freezeLoading
                      ? 'Freezing…'
                      : 'Freeze Core'}
                </button>
              </div>
              <div>
                <div className="text-xs text-gray-500">Tones</div>
                <div>{profile.text?.tone?.join(', ') || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Top Topics</div>
                <div className="space-y-1">
                  {(profile.topics || []).slice(0, 20).map((t) => (
                    <div key={t.value} className="flex items-center justify-between">
                      <span>{t.value}</span>
                      <span className="text-xs text-gray-500">{t.count}</span>
                    </div>
                  ))}
                  {(profile.topics || []).length === 0 && <div>—</div>}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Palette</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(profile.visual?.palette || []).slice(0, 12).map((hex) => (
                    <span
                      key={hex}
                      title={hex}
                      className="inline-block h-5 w-5 rounded border border-gray-200"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                  {(!profile.visual?.palette || profile.visual?.palette.length === 0) && (
                    <div>—</div>
                  )}
                </div>
              </div>
              {profile.anchors?.visual?.palette && profile.anchors.visual.palette.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500">Anchors (Official Colors)</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {profile.anchors.visual.palette.slice(0, 12).map((hex) => (
                      <span
                        key={hex}
                        title={hex}
                        className="inline-block h-5 w-5 rounded border border-gray-200"
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-xs text-gray-500">Motifs</div>
                <div>{profile.visual?.motifs?.join(', ') || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Composition</div>
                <div>{profile.visual?.composition?.join(', ') || '—'}</div>
              </div>
              {Array.isArray(profile.overlays) && profile.overlays.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-700">Overlays</div>
                  <div className="mt-2 space-y-3">
                    {profile.overlays.map((ov, idx) => (
                      <div
                        key={`${ov.type}-${ov.label || idx}`}
                        className="rounded border border-gray-200 p-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-gray-500">
                            {ov.type} {ov.label ? `· ${ov.label}` : ''}
                          </div>
                          <div className="text-[11px] text-gray-400">
                            {ov.expiresAt
                              ? `expires ${new Date(ov.expiresAt).toLocaleDateString()}`
                              : ''}
                          </div>
                        </div>
                        {ov.topics && ov.topics.length > 0 && (
                          <div className="mt-1 text-xs text-gray-700">
                            Topics:{' '}
                            {ov.topics
                              .slice(0, 8)
                              .map((t) => t.value)
                              .join(', ')}
                          </div>
                        )}
                        {/* Optional effect estimate, if present */}
                        {(ov as any)?.source?.effectEstimate !== undefined && (
                          <div className="mt-1 text-[11px] text-gray-600">
                            Effect:{' '}
                            {(((ov as any).source.effectEstimate as number) * 100).toFixed(1)}%
                            {(ov as any).source.method ? ` (${(ov as any).source.method})` : ''}
                          </div>
                        )}
                        {ov.visual?.palette && ov.visual.palette.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {ov.visual.palette.slice(0, 12).map((hex) => (
                              <span
                                key={hex}
                                title={hex}
                                className="inline-block h-4 w-4 rounded border border-gray-200"
                                style={{ backgroundColor: hex }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
