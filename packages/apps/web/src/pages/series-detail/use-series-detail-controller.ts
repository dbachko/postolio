import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { content as contentApi } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';
import { useCalendarFilterStore } from '@/stores/calendarFilterStore';
import type {
  ContentSeries,
  GenerationSummary,
  RollingConfig,
  RollingStatus,
  SeriesContentItem,
} from './types';
import { toRollingConfig } from './utils';

function useSeriesDetailQueries(contentSeriesId?: string) {
  const seriesQuery = useQuery({
    queryKey: ['content-series-detail', contentSeriesId],
    enabled: Boolean(contentSeriesId),
    queryFn: async () => await contentApi.getSeries(contentSeriesId!),
  });
  const rollingStatusQuery = useQuery({
    queryKey: ['content-series-rolling-status', contentSeriesId],
    enabled: Boolean(contentSeriesId),
    queryFn: async () => await contentApi.getSeriesRollingStatus(contentSeriesId!),
    retry: false,
  });
  return { seriesQuery, rollingStatusQuery };
}

function useSeriesDetailData(
  seriesData: unknown,
  rollingStatusData: unknown
): {
  series: ContentSeries | null;
  generations: GenerationSummary[];
  contents: SeriesContentItem[];
  rollingStatus: RollingStatus | null;
} {
  return useMemo(() => {
    const data = seriesData as any;
    return {
      series: (data?.data?.contentSeries ?? null) as ContentSeries | null,
      generations: (data?.data?.generations ?? []) as GenerationSummary[],
      contents: (data?.data?.contents ?? []) as SeriesContentItem[],
      rollingStatus: ((rollingStatusData as any)?.data?.rolling ?? null) as RollingStatus | null,
    };
  }, [seriesData, rollingStatusData]);
}

function useRollingDraft(series: ContentSeries | null) {
  const [rollingDraft, setRollingDraft] = useState<RollingConfig>(() =>
    toRollingConfig(series?.rollingConfigJson)
  );
  useEffect(() => {
    setRollingDraft(toRollingConfig(series?.rollingConfigJson));
  }, [series?.rollingConfigJson]);
  return { rollingDraft, setRollingDraft };
}

function useSeriesDetailMutations({
  contentSeriesId,
  selectedBrandId,
}: {
  contentSeriesId?: string;
  selectedBrandId?: string;
}) {
  const queryClient = useQueryClient();
  const updateMutation = useMutation({
    mutationFn: async (payload: { status?: ContentSeries['status']; rolling?: RollingConfig }) => {
      if (!contentSeriesId) {
        throw new Error('Missing series id');
      }
      return await contentApi.updateSeries(contentSeriesId, payload);
    },
    onSuccess: async () => {
      toast.success('Series updated');
      await queryClient.invalidateQueries({ queryKey: ['content-series-detail', contentSeriesId] });
      await queryClient.invalidateQueries({
        queryKey: ['content-series-rolling-status', contentSeriesId],
      });
      if (selectedBrandId) {
        await queryClient.invalidateQueries({ queryKey: ['content-series', selectedBrandId] });
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update series');
    },
  });
  const refreshRollingMutation = useMutation({
    mutationFn: async () => {
      if (!contentSeriesId) {
        throw new Error('Missing series id');
      }
      return await contentApi.refreshSeriesRolling(contentSeriesId);
    },
    onSuccess: async (response: any) => {
      const refresh = response?.data?.rollingRefresh;
      toast.success(
        refresh?.triggered && refresh?.runId
          ? 'Rolling refresh enqueued'
          : 'Rolling status refreshed'
      );
      await queryClient.invalidateQueries({ queryKey: ['content-series-detail', contentSeriesId] });
      await queryClient.invalidateQueries({
        queryKey: ['content-series-rolling-status', contentSeriesId],
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to refresh rolling queue');
    },
  });
  return { updateMutation, refreshRollingMutation };
}

export function useSeriesDetailController() {
  const navigate = useNavigate();
  const { selectedBrand } = useBrandStore();
  const { contentSeriesId } = useParams<{ contentSeriesId: string }>();
  const { seriesQuery, rollingStatusQuery } = useSeriesDetailQueries(contentSeriesId);
  const { series, generations, contents, rollingStatus } = useSeriesDetailData(
    seriesQuery.data,
    rollingStatusQuery.data
  );
  const { rollingDraft, setRollingDraft } = useRollingDraft(series);
  const { updateMutation, refreshRollingMutation } = useSeriesDetailMutations({
    contentSeriesId,
    selectedBrandId: selectedBrand?.id,
  });
  const canEditStatus =
    Boolean(series) && Boolean(selectedBrand) && series?.brandId === selectedBrand?.id;
  const nextPauseResume = useMemo(() => {
    if (!series) {
      return null;
    }
    if (series.status === 'active') {
      return { label: 'Pause', status: 'paused' as const };
    }
    if (series.status === 'paused') {
      return { label: 'Resume', status: 'active' as const };
    }
    return null;
  }, [series]);

  return {
    contentSeriesId,
    navigate,
    openCalendar: (seriesId: string) => {
      useCalendarFilterStore.getState().setSeries([seriesId]);
      navigate('/content');
    },
    seriesQuery,
    series,
    generations,
    contents,
    rollingStatus,
    rollingDraft,
    setRollingDraft,
    canEditStatus,
    nextPauseResume,
    updateMutation,
    refreshRollingMutation,
  };
}
