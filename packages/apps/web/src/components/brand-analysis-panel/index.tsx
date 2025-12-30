import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { brand as brandApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { EmptyState } from './components/empty-state';
import { Heading } from './components/heading';
import { PaletteGrid } from './components/palette-grid';
import { TagBadges } from './components/tag-badges';
import { ToneChips } from './components/tone-chips';
import { TopicList } from './components/topic-list';
import type { AnalysisProfile, BrandAnalysisPanelProps, BrandAnalysisStatus } from './types';
import { createChipStyleFor } from './utils';

export function BrandAnalysisPanel({ brandId, triggerKey }: BrandAnalysisPanelProps) {
  const qc = useQueryClient();
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<BrandAnalysisStatus | null>(null);
  const pollTimer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollTimer.current = window.setInterval(async () => {
      try {
        const s = await brandApi.getBrandAnalysisStatus(brandId);
        const next: BrandAnalysisStatus = {
          state: s.status as BrandAnalysisStatus['state'],
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          error: s.error,
        };
        setStatus(next);

        if (next.state === 'completed' || next.state === 'failed' || next.state === 'none') {
          stopPolling();
          setIsRunning(false);
          if (next.state === 'completed') {
            qc.invalidateQueries({ queryKey: ['brand-analysis-profile', brandId] });
          }
        } else {
          setIsRunning(true);
        }
      } catch (_e) {
        stopPolling();
        setIsRunning(false);
      }
    }, 3000);
  }, [brandId, qc, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const runAnalysis = useCallback(async () => {
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
  }, [brandId, startPolling]);

  useEffect(() => {
    if (typeof triggerKey !== 'number') return;
    if (isRunning) return;
    void runAnalysis();
  }, [triggerKey, isRunning, runAnalysis]);

  const profileQuery = useQuery<AnalysisProfile | { error: string }>({
    queryKey: ['brand-analysis-profile', brandId],
    queryFn: async () => (await brandApi.getBrandAnalysisProfile(brandId)) as any,
    retry: 1,
  });

  const profile = useMemo(() => {
    if (!profileQuery.data || 'error' in profileQuery.data) return null;
    return profileQuery.data as AnalysisProfile;
  }, [profileQuery.data]);

  const chipStyleFor = useMemo(
    () => createChipStyleFor(profile?.visual?.palette),
    [profile?.visual?.palette]
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
      <Button size="sm" onClick={() => void runAnalysis()} disabled={isRunning} variant="purple">
        {isRunning ? 'Running…' : 'Run Analysis'}
      </Button>
    </div>
  );

  const statusBanner = status ? (
    <div className="bg-muted mb-3 rounded-md px-3 py-2 text-xs">
      {status.state === 'failed' ? (
        <span>Analysis failed{status.error ? `: ${status.error}` : ''}</span>
      ) : null}
      {status.state === 'accepted' ? <span>Analysis accepted. Starting…</span> : null}
      {status.state === 'running' ? <span>Analysis in progress…</span> : null}
      {status.state === 'completed' ? <span>Analysis completed.</span> : null}
    </div>
  ) : null;

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

      {profileQuery.isLoading ? (
        <div className="flex items-center justify-center py-6">
          <div className="border-foreground h-6 w-6 animate-spin rounded-full border-b-2" />
        </div>
      ) : null}

      {!profile && !profileQuery.isLoading ? (
        <EmptyState
          isRunning={isRunning}
          runError={runError}
          onRunAnalysis={() => void runAnalysis()}
        />
      ) : null}

      {profile ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <Heading title="Brand Tone" />
            {profile.text?.tone && profile.text.tone.length > 0 ? (
              <ToneChips tones={profile.text.tone} getChipStyle={chipStyleFor} />
            ) : (
              <p className="text-muted-foreground text-sm">No tone detected yet.</p>
            )}
          </div>

          <div>
            <Heading title="Top Topics" />
            {profile.topics && profile.topics.length > 0 ? (
              <TopicList topics={profile.topics} getChipStyle={chipStyleFor} />
            ) : (
              <p className="text-muted-foreground text-sm">No topics extracted yet.</p>
            )}
          </div>

          <div>
            <Heading title="Color Palette" />
            {profile.visual?.palette && profile.visual.palette.length > 0 ? (
              <PaletteGrid colors={profile.visual.palette} />
            ) : (
              <p className="text-muted-foreground text-sm">No palette extracted.</p>
            )}
          </div>

          <div>
            <Heading title="Visual Motifs" />
            {profile.visual?.motifs && profile.visual.motifs.length > 0 ? (
              <TagBadges items={profile.visual.motifs} getChipStyle={chipStyleFor} />
            ) : (
              <p className="text-muted-foreground text-sm">No motifs identified.</p>
            )}

            <div className="mt-4">
              <Heading title="Composition" />
              {profile.visual?.composition && profile.visual.composition.length > 0 ? (
                <TagBadges items={profile.visual.composition} getChipStyle={chipStyleFor} />
              ) : (
                <p className="text-muted-foreground text-sm">No composition traits detected.</p>
              )}
            </div>
          </div>

          <div className="sm:col-span-2">
            <p className="text-muted-foreground mt-2 text-xs">
              Version {profile.version} • Updated {new Date(profile.createdAt).toLocaleString()}
              {profile.promptSetVersion ? ` • Prompt Set ${profile.promptSetVersion}` : ''}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
