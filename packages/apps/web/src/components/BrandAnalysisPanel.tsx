import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { brand as brandApi } from '@/lib/api';

type AnalysisProfile = {
  brandId: string;
  version: number;
  createdAt: string;
  promptSetVersion?: string;
  text?: { tone?: string[] };
  topics?: Array<{ value: string; count: number }>;
  visual?: { palette?: string[]; motifs?: string[]; composition?: string[] };
};

export function BrandAnalysisPanel({
  brandId,
  triggerKey,
}: {
  brandId: string;
  triggerKey?: number;
}) {
  const qc = useQueryClient();
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<{
    state: 'none' | 'accepted' | 'running' | 'completed' | 'failed';
    startedAt?: string;
    completedAt?: string;
    error?: string;
  } | null>(null);
  const pollTimer = useRef<number | null>(null);

  // Fetch latest profile
  const profileQuery = useQuery<AnalysisProfile | { error: string }>({
    queryKey: ['brand-analysis-profile', brandId],
    queryFn: async () => (await brandApi.getBrandAnalysisProfile(brandId)) as any,
    retry: 1,
  });

  const profile = useMemo(() => {
    if (!profileQuery.data || 'error' in profileQuery.data) return null;
    return profileQuery.data as AnalysisProfile;
  }, [profileQuery.data]);

  const startPolling = () => {
    stopPolling();
    pollTimer.current = window.setInterval(async () => {
      try {
        const s = await brandApi.getBrandAnalysisStatus(brandId);
        const state = s.status as 'none' | 'accepted' | 'running' | 'completed' | 'failed';
        const next = {
          state,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          error: s.error,
        } as const;
        setStatus(next);

        if (next.state === 'completed' || next.state === 'failed' || next.state === 'none') {
          stopPolling();
          setIsRunning(false);
          // Refresh profile on completion
          if (next.state === 'completed') {
            qc.invalidateQueries({ queryKey: ['brand-analysis-profile', brandId] });
          }
        }
      } catch (_e) {
        // Stop polling on repeated failure
        stopPolling();
        setIsRunning(false);
      }
    }, 3000);
  };

  const stopPolling = () => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  // Handle external trigger to start analysis
  useEffect(() => {
    if (typeof triggerKey !== 'number') return;
    // Avoid spamming start if already running
    if (!isRunning) {
      runAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  const runAnalysis = async () => {
    setRunError(null);
    setIsRunning(true);
    setStatus({ state: 'accepted' });
    try {
      await brandApi.startBrandAnalysis(brandId, { force: true, maxPosts: 20 });
      startPolling();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to start analysis';
      setRunError(msg);
      setIsRunning(false);
    }
  };

  const ToneChips = ({ tones }: { tones: string[] }) => (
    <div className="mt-2 flex flex-wrap gap-2">
      {tones.map((t) => (
        <span
          key={t}
          className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-200"
        >
          {t}
        </span>
      ))}
    </div>
  );

  const TopicList = ({ topics }: { topics: Array<{ value: string; count: number }> }) => (
    <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {topics.slice(0, 16).map((tp) => (
        <li
          key={tp.value}
          className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2"
        >
          <span className="truncate text-sm text-gray-700">{tp.value}</span>
          <span className="ml-3 inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {tp.count}
          </span>
        </li>
      ))}
    </ul>
  );

  const Palette = ({ colors }: { colors: string[] }) => (
    <div className="mt-2 grid grid-cols-5 gap-3 sm:grid-cols-8">
      {colors.slice(0, 16).map((hex) => (
        <div key={hex} className="flex flex-col items-center">
          <div
            className="h-8 w-8 rounded shadow ring-1 ring-black/5"
            style={{ backgroundColor: hex }}
            title={hex}
          />
          <span className="mt-1 text-[10px] text-gray-500">{hex}</span>
        </div>
      ))}
    </div>
  );

  const Badges = ({
    items,
    color = 'blue',
  }: {
    items: string[];
    color?: 'blue' | 'amber' | 'emerald';
  }) => {
    const colorMap: Record<string, string> = {
      blue: 'bg-blue-50 text-blue-700 ring-blue-200',
      amber: 'bg-amber-50 text-amber-700 ring-amber-200',
      emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    };
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {items.slice(0, 20).map((it) => (
          <span
            key={it}
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset ${colorMap[color]}`}
          >
            {it}
          </span>
        ))}
      </div>
    );
  };

  const Heading = ({ title, action }: { title: string; action?: React.ReactNode }) => (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-sm font-medium text-gray-900">{title}</h3>
      {action}
    </div>
  );

  const EmptyState = () => (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-gray-200 p-6 text-center">
      <p className="mb-3 text-sm text-gray-600">
        No analysis yet. Run an analysis to extract tone, topics, and visual style from your recent
        Instagram posts.
      </p>
      <button
        onClick={runAnalysis}
        disabled={isRunning}
        className="inline-flex items-center rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
      >
        {isRunning ? 'Starting…' : 'Run Analysis'}
      </button>
      {runError && <p className="mt-2 text-xs text-red-600">{runError}</p>}
    </div>
  );

  const headerAction = (
    <div className="flex items-center gap-2">
      <button
        onClick={() => qc.invalidateQueries({ queryKey: ['brand-analysis-profile', brandId] })}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
      >
        Refresh
      </button>
      <button
        onClick={runAnalysis}
        disabled={isRunning}
        className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
      >
        {isRunning ? 'Running…' : 'Run Analysis'}
      </button>
    </div>
  );

  const statusBanner = status && (
    <div
      className={`mb-3 rounded-md px-3 py-2 text-xs ${
        status.state === 'failed'
          ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200'
          : status.state === 'completed'
            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
            : 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
      }`}
    >
      {status.state === 'failed' && (
        <span>Analysis failed{status.error ? `: ${status.error}` : ''}</span>
      )}
      {status.state === 'accepted' && <span>Analysis accepted. Starting…</span>}
      {status.state === 'running' && <span>Analysis in progress…</span>}
      {status.state === 'completed' && <span>Analysis completed.</span>}
    </div>
  );

  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Brand Analysis</h2>
          <p className="mt-1 text-xs text-gray-500">
            Extracted tone, topics, and visual style from recent Instagram posts.
          </p>
        </div>
        {headerAction}
      </div>

      {statusBanner}

      {profileQuery.isLoading && (
        <div className="flex items-center justify-center py-6">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-gray-900" />
        </div>
      )}

      {!profile && !profileQuery.isLoading && <EmptyState />}

      {profile && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {/* Tone */}
          <div>
            <Heading title="Brand Tone" />
            {profile.text?.tone && profile.text.tone.length > 0 ? (
              <ToneChips tones={profile.text.tone} />
            ) : (
              <p className="text-sm text-gray-500">No tone detected yet.</p>
            )}
          </div>

          {/* Topics */}
          <div>
            <Heading title="Top Topics" />
            {profile.topics && profile.topics.length > 0 ? (
              <TopicList topics={profile.topics} />
            ) : (
              <p className="text-sm text-gray-500">No topics extracted yet.</p>
            )}
          </div>

          {/* Palette */}
          <div>
            <Heading title="Color Palette" />
            {profile.visual?.palette && profile.visual.palette.length > 0 ? (
              <Palette colors={profile.visual.palette} />
            ) : (
              <p className="text-sm text-gray-500">No palette extracted.</p>
            )}
          </div>

          {/* Motifs & Composition */}
          <div>
            <Heading title="Visual Motifs" />
            {profile.visual?.motifs && profile.visual.motifs.length > 0 ? (
              <Badges items={profile.visual.motifs} color="amber" />
            ) : (
              <p className="text-sm text-gray-500">No motifs identified.</p>
            )}

            <div className="mt-4">
              <Heading title="Composition" />
              {profile.visual?.composition && profile.visual.composition.length > 0 ? (
                <Badges items={profile.visual.composition} color="emerald" />
              ) : (
                <p className="text-sm text-gray-500">No composition traits detected.</p>
              )}
            </div>
          </div>

          {/* Meta */}
          <div className="sm:col-span-2">
            <p className="mt-2 text-xs text-gray-400">
              Version {profile.version} • Updated {new Date(profile.createdAt).toLocaleString()}
              {profile.promptSetVersion ? ` • Prompt Set ${profile.promptSetVersion}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
