import { useMemo } from 'react';
import { FullCalendar } from '@/components/calendar/FullCalendar/full-calendar';
import { QueueSchedulesView } from '@/components/calendar/QueueSchedules/queue-schedules-view';
import { ErrorBoundary } from '@/components/error-boundary';
import { useURLFilterSync } from '@/hooks/useURLFilterSync';
import { useContentViewStore } from '@/stores/contentViewStore';
import { ContentCalendarHeader } from './components/content-calendar-header';
import { useBrandTimezone } from './hooks/use-brand-timezone';
import { useContentCalendarMonthData } from './hooks/use-content-calendar-month-data';
import { useContentCalendarUrlState } from './hooks/use-content-calendar-url-state';
import type { ContentCalendarProps } from './types';

export function ContentCalendar({ brandId }: ContentCalendarProps) {
  useURLFilterSync();

  const { viewMode, currentDate, handleNext, handlePrevious, handleToday, setViewMode } =
    useContentCalendarUrlState();
  const { brandTimezone, setBrandTimezone } = useBrandTimezone(brandId);
  const { mergedContent, placeholders } = useContentCalendarMonthData({ brandId, currentDate });

  const selectedSocialAccountIds = useContentViewStore(
    (s) => s.selectedSocialAccountIdsByBrandId[brandId]
  );
  const scopedContent = useMemo(() => {
    if (!Array.isArray(selectedSocialAccountIds) || selectedSocialAccountIds.length === 0) {
      return mergedContent;
    }
    const allowed = new Set(selectedSocialAccountIds);
    // If the user has scoped to specific destinations, keep destination-targeted posts that match,
    // but also keep "unassigned" drafts (targetSocialAccountId=null) so runs that create drafts
    // still appear in the calendar.
    return mergedContent.filter((item) => {
      if (!item.targetSocialAccountId) return true;
      return allowed.has(item.targetSocialAccountId);
    });
  }, [mergedContent, selectedSocialAccountIds]);

  const calendarDisabled = useMemo(() => {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    return params.get('calendar') === 'off' || params.get('disableCalendar') === '1';
  }, []);

  return (
    <div className="space-y-6">
      <ContentCalendarHeader
        brandId={brandId}
        currentDate={currentDate}
        viewMode={viewMode}
        onPrevious={handlePrevious}
        onToday={handleToday}
        onNext={handleNext}
        onViewModeChange={setViewMode}
        brandTimezone={brandTimezone}
        onBrandTimezoneChange={setBrandTimezone}
      />

      {calendarDisabled ? (
        <div className="text-muted-foreground text-sm">Calendar disabled (safe mode)</div>
      ) : viewMode === 'queue' ? (
        <QueueSchedulesView
          brandId={brandId}
          brandTimezone={brandTimezone}
          date={currentDate}
          calendarContent={scopedContent}
          selectedSocialAccountIds={
            Array.isArray(selectedSocialAccountIds) ? selectedSocialAccountIds : null
          }
        />
      ) : (
        <ErrorBoundary
          fallback={<div className="text-destructive text-sm">Failed to load calendar</div>}
        >
          <FullCalendar
            brandId={brandId}
            brandTimezone={brandTimezone}
            view={viewMode}
            date={currentDate}
            content={scopedContent}
            placeholders={placeholders}
            theme="monarch"
            targetSocialAccountIds={
              Array.isArray(selectedSocialAccountIds) ? selectedSocialAccountIds : null
            }
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
