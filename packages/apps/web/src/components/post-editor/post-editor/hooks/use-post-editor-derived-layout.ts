import { useMemo } from 'react';
import { formatInTimeZone } from 'date-fns-tz';

import { cn } from '@/lib/utils';

import type { PostEditorDerivedParams } from './use-post-editor-derived-types';

export function usePostEditorLayoutState(
  params: Pick<
    PostEditorDerivedParams,
    | 'layout'
    | 'id'
    | 'post'
    | 'isMultiDestinationGroup'
    | 'contentGroupSchedule'
    | 'groupDestinations'
    | 'formData'
    | 'selectedPlatforms'
    | 'brandTimezone'
  >
) {
  const disabled = params.post?.status === 'published' || Boolean(params.post?.postedAt);
  const isScheduled = params.isMultiDestinationGroup
    ? params.contentGroupSchedule.kind !== 'none'
    : params.post?.status === 'scheduled';

  const containerClass = useMemo(
    () =>
      cn(
        'flex flex-col',
        params.layout === 'sidebar'
          ? 'h-full shadow-lg'
          : 'min-h-[60vh] w-full overflow-hidden rounded-lg border border-border bg-card'
      ),
    [params.layout]
  );

  const headerClass = useMemo(
    () =>
      cn(
        'bg-card flex items-center justify-between border-b px-4',
        params.layout === 'sidebar' ? 'sticky top-0 z-30 h-12' : 'h-14 rounded-t'
      ),
    [params.layout]
  );

  const activeDestinationLabel = useMemo(() => {
    if (!params.id || !params.isMultiDestinationGroup) {
      return null;
    }

    const destination = params.groupDestinations.find((entry) => entry.contentId === params.id);
    return destination?.label ?? null;
  }, [params.groupDestinations, params.id, params.isMultiDestinationGroup]);

  return {
    disabled,
    isScheduled,
    minScheduleInput: formatInTimeZone(new Date(), params.brandTimezone, "yyyy-MM-dd'T'HH:mm"),
    containerClass,
    headerClass,
    bodyClass:
      params.layout === 'sidebar'
        ? 'flex-1 min-h-0 min-w-0 overflow-y-auto px-4 pt-3 pb-32'
        : 'flex-1 min-h-0 min-w-0 overflow-y-auto px-4 pt-3 pb-4',
    groupBodyClass:
      params.layout === 'sidebar'
        ? 'flex-1 min-h-0 min-w-0 overflow-y-auto px-4 pb-32'
        : 'flex-1 min-h-0 min-w-0 overflow-y-auto px-4 pb-4',
    activeDestinationLabel,
    allowMixedMedia:
      params.formData.contentType !== 'reel' && !params.selectedPlatforms.includes('facebook'),
  };
}
