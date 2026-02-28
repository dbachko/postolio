import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
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

type AnalysisProfileQueryData = AnalysisProfile | { error: string };

function useBrandAnalysisRunner({
  brandId,
  triggerKey,
  onCompleted,
}: {
  brandId: string;
  triggerKey: number | undefined;
  onCompleted: () => void;
}) {
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<BrandAnalysisStatus | null>(null);
  const pollTimer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (!pollTimer.current) {
      return;
    }
    window.clearInterval(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollTimer.current = window.setInterval(async () => {
      try {
        const response = await brandApi.getBrandAnalysisStatus(brandId);
        const nextStatus: BrandAnalysisStatus = {
          state: response.status as BrandAnalysisStatus['state'],
          startedAt: response.startedAt,
          completedAt: response.completedAt,
          error: response.error,
        };
        setStatus(nextStatus);
        if (
          nextStatus.state === 'completed' ||
          nextStatus.state === 'failed' ||
          nextStatus.state === 'none'
        ) {
          stopPolling();
          setIsRunning(false);
          if (nextStatus.state === 'completed') {
            onCompleted();
          }
          return;
        }
        setIsRunning(true);
      } catch {
        stopPolling();
        setIsRunning(false);
      }
    }, 3000);
  }, [brandId, onCompleted, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const runAnalysis = useCallback(async () => {
    setRunError(null);
    setIsRunning(true);
    setStatus({ state: 'accepted' });
    try {
      await brandApi.startBrandAnalysis(brandId, { force: true, maxPosts: 20 });
      startPolling();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start analysis';
      setRunError(message);
      setIsRunning(false);
    }
  }, [brandId, startPolling]);

  useEffect(() => {
    if (typeof triggerKey !== 'number' || isRunning) {
      return;
    }
    void runAnalysis();
  }, [triggerKey, isRunning, runAnalysis]);

  return { runError, isRunning, status, runAnalysis };
}

function StatusBanner({ status }: { status: BrandAnalysisStatus | null }) {
  if (!status) {
    return null;
  }

  return (
    <div className="bg-muted mb-3 rounded-md px-3 py-2 text-xs">
      {status.state === 'failed' ? (
        <span>Analysis failed{status.error ? `: ${status.error}` : ''}</span>
      ) : null}
      {status.state === 'accepted' ? <span>Analysis accepted. Starting…</span> : null}
      {status.state === 'running' ? <span>Analysis in progress…</span> : null}
      {status.state === 'completed' ? <span>Analysis completed.</span> : null}
    </div>
  );
}

function PanelHeader({
  isRunning,
  onRefresh,
  onRunAnalysis,
}: {
  isRunning: boolean;
  onRefresh: () => void;
  onRunAnalysis: () => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <h2 className="text-foreground text-base font-semibold">Brand Analysis</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Extracted tone, topics, and visual style from recent Instagram posts.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
        <Button size="sm" onClick={onRunAnalysis} disabled={isRunning} variant="purple">
          {isRunning ? 'Running…' : 'Run Analysis'}
        </Button>
      </div>
    </div>
  );
}

function ProfileSection({
  title,
  hasItems,
  emptyText,
  children,
}: {
  title: string;
  hasItems: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Heading title={title} />
      {hasItems ? children : <p className="text-muted-foreground text-sm">{emptyText}</p>}
    </div>
  );
}

function ProfileGrid({
  profile,
  chipStyleFor,
}: {
  profile: AnalysisProfile;
  chipStyleFor: (value: string) => CSSProperties;
}) {
  const tones = profile.text?.tone ?? [];
  const topics = profile.topics ?? [];
  const palette = profile.visual?.palette ?? [];
  const motifs = profile.visual?.motifs ?? [];
  const composition = profile.visual?.composition ?? [];

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      <ProfileSection
        title="Brand Tone"
        hasItems={tones.length > 0}
        emptyText="No tone detected yet."
      >
        <ToneChips tones={tones} getChipStyle={chipStyleFor} />
      </ProfileSection>

      <ProfileSection
        title="Top Topics"
        hasItems={topics.length > 0}
        emptyText="No topics extracted yet."
      >
        <TopicList topics={topics} getChipStyle={chipStyleFor} />
      </ProfileSection>

      <ProfileSection
        title="Color Palette"
        hasItems={palette.length > 0}
        emptyText="No palette extracted."
      >
        <PaletteGrid colors={palette} />
      </ProfileSection>

      <div>
        <ProfileSection
          title="Visual Motifs"
          hasItems={motifs.length > 0}
          emptyText="No motifs identified."
        >
          <TagBadges items={motifs} getChipStyle={chipStyleFor} />
        </ProfileSection>
        <div className="mt-4">
          <ProfileSection
            title="Composition"
            hasItems={composition.length > 0}
            emptyText="No composition traits detected."
          >
            <TagBadges items={composition} getChipStyle={chipStyleFor} />
          </ProfileSection>
        </div>
      </div>

      <div className="sm:col-span-2">
        <p className="text-muted-foreground mt-2 text-xs">
          Version {profile.version} • Updated {new Date(profile.createdAt).toLocaleString()}
          {profile.promptSetVersion ? ` • Prompt Set ${profile.promptSetVersion}` : ''}
        </p>
      </div>
    </div>
  );
}

export function BrandAnalysisPanel({ brandId, triggerKey }: BrandAnalysisPanelProps) {
  const queryClient = useQueryClient();
  const onCompleted = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['brand-analysis-profile', brandId] });
  }, [brandId, queryClient]);

  const { runError, isRunning, status, runAnalysis } = useBrandAnalysisRunner({
    brandId,
    triggerKey,
    onCompleted,
  });

  const profileQuery = useQuery<AnalysisProfileQueryData>({
    queryKey: ['brand-analysis-profile', brandId],
    queryFn: async () => (await brandApi.getBrandAnalysisProfile(brandId)) as any,
    retry: 1,
  });

  const profile = useMemo(() => {
    if (!profileQuery.data || 'error' in profileQuery.data) {
      return null;
    }
    return profileQuery.data;
  }, [profileQuery.data]);

  const chipStyleFor = useMemo(
    () => createChipStyleFor(profile?.visual?.palette),
    [profile?.visual?.palette]
  );

  return (
    <div className="bg-card rounded-lg p-4 shadow">
      <PanelHeader
        isRunning={isRunning}
        onRefresh={() => onCompleted()}
        onRunAnalysis={() => void runAnalysis()}
      />
      <StatusBanner status={status} />
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
      {profile ? <ProfileGrid profile={profile} chipStyleFor={chipStyleFor} /> : null}
    </div>
  );
}
