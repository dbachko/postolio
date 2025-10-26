import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { brand as brandApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { hexToRgba } from '@/utils/campaign-colors';

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

  // Palette helpers: pick a stable color from extracted palette based on a key
  const pickFromPalette = (key: string): string | null => {
    const palette = profile?.visual?.palette || [];
    if (!palette.length) return null;
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return palette[hash % palette.length] || null;
  };

  const chipStyleFor = (key: string): React.CSSProperties | undefined => {
    const hex = pickFromPalette(key);
    if (!hex) return undefined;
    return {
      backgroundColor: hexToRgba(hex, 0.15),
      border: `1px solid ${hex}`,
    } as React.CSSProperties;
  };

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
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={chipStyleFor(t)}
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
          className="flex items-center justify-between rounded-md border px-3 py-2"
        >
          <span className="text-foreground truncate text-sm">{tp.value}</span>
          <span
            className="ml-3 inline-flex items-center rounded px-2 py-0.5 text-xs"
            style={chipStyleFor(tp.value)}
          >
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
          <span className="text-muted-foreground mt-1 text-[10px]">{hex}</span>
        </div>
      ))}
    </div>
  );

  const Badges = ({ items }: { items: string[] }) => {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {items.slice(0, 20).map((it) => (
          <span
            key={it}
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs"
            style={chipStyleFor(it)}
          >
            {it}
          </span>
        ))}
      </div>
    );
  };

  const Heading = ({ title, action }: { title: string; action?: React.ReactNode }) => (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-foreground text-sm font-medium">{title}</h3>
      {action}
    </div>
  );

  const EmptyState = () => (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed p-6 text-center">
      <p className="text-muted-foreground mb-3 text-sm">
        No analysis yet. Run an analysis to extract tone, topics, and visual style from your recent
        Instagram posts.
      </p>
      <Button onClick={runAnalysis} disabled={isRunning} size="sm" variant="purple">
        {isRunning ? 'Starting…' : 'Run Analysis'}
      </Button>
      {runError && <p className="text-destructive mt-2 text-xs">{runError}</p>}
    </div>
  );

  const headerAction = (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => qc.invalidateQueries({ queryKey: ['brand-analysis-profile', brandId] })}
      >
        Refresh
      </Button>
      <Button size="sm" onClick={runAnalysis} disabled={isRunning} variant="purple">
        {isRunning ? 'Running…' : 'Run Analysis'}
      </Button>
    </div>
  );

  const statusBanner = status && (
    <div className="bg-muted mb-3 rounded-md px-3 py-2 text-xs">
      {status.state === 'failed' && (
        <span>Analysis failed{status.error ? `: ${status.error}` : ''}</span>
      )}
      {status.state === 'accepted' && <span>Analysis accepted. Starting…</span>}
      {status.state === 'running' && <span>Analysis in progress…</span>}
      {status.state === 'completed' && <span>Analysis completed.</span>}
    </div>
  );

  return (
    <div className="bg-card rounded-lg p-4 shadow">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-foreground text-base font-semibold">Brand Analysis</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Extracted tone, topics, and visual style from recent Instagram posts.
          </p>
        </div>
        {headerAction}
      </div>

      {statusBanner}

      {profileQuery.isLoading && (
        <div className="flex items-center justify-center py-6">
          <div className="border-foreground h-6 w-6 animate-spin rounded-full border-b-2" />
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
              <p className="text-muted-foreground text-sm">No tone detected yet.</p>
            )}
          </div>

          {/* Topics */}
          <div>
            <Heading title="Top Topics" />
            {profile.topics && profile.topics.length > 0 ? (
              <TopicList topics={profile.topics} />
            ) : (
              <p className="text-muted-foreground text-sm">No topics extracted yet.</p>
            )}
          </div>

          {/* Palette */}
          <div>
            <Heading title="Color Palette" />
            {profile.visual?.palette && profile.visual.palette.length > 0 ? (
              <Palette colors={profile.visual.palette} />
            ) : (
              <p className="text-muted-foreground text-sm">No palette extracted.</p>
            )}
          </div>

          {/* Motifs & Composition */}
          <div>
            <Heading title="Visual Motifs" />
            {profile.visual?.motifs && profile.visual.motifs.length > 0 ? (
              <Badges items={profile.visual.motifs} />
            ) : (
              <p className="text-muted-foreground text-sm">No motifs identified.</p>
            )}

            <div className="mt-4">
              <Heading title="Composition" />
              {profile.visual?.composition && profile.visual.composition.length > 0 ? (
                <Badges items={profile.visual.composition} />
              ) : (
                <p className="text-muted-foreground text-sm">No composition traits detected.</p>
              )}
            </div>
          </div>

          {/* Meta */}
          <div className="sm:col-span-2">
            <p className="text-muted-foreground mt-2 text-xs">
              Version {profile.version} • Updated {new Date(profile.createdAt).toLocaleString()}
              {profile.promptSetVersion ? ` • Prompt Set ${profile.promptSetVersion}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
