import { Button } from '@/components/ui/button';
import { SeriesDetailView } from './series-detail/series-detail-view';
import { useSeriesDetailController } from './series-detail/use-series-detail-controller';

export function SeriesDetail() {
  const controller = useSeriesDetailController();

  if (!controller.contentSeriesId) {
    return <div className="text-muted-foreground text-sm">Missing series id.</div>;
  }
  if (controller.seriesQuery.isLoading) {
    return <div className="text-muted-foreground text-sm">Loading…</div>;
  }
  if (!controller.series) {
    return (
      <div className="space-y-3">
        <div className="text-muted-foreground text-sm">Series not found.</div>
        <Button variant="outline" onClick={() => controller.navigate('/series')}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <SeriesDetailView
      navigate={controller.navigate}
      openCalendar={controller.openCalendar}
      series={controller.series}
      generations={controller.generations}
      contents={controller.contents}
      rollingStatus={controller.rollingStatus}
      rollingDraft={controller.rollingDraft}
      setRollingDraft={controller.setRollingDraft}
      canEditStatus={controller.canEditStatus}
      nextPauseResume={controller.nextPauseResume}
      updateMutation={controller.updateMutation}
      refreshRollingMutation={controller.refreshRollingMutation}
    />
  );
}
