import { useEffect, useMemo, useRef, useState } from 'react';
import { setLocalSetting } from '@/lib/settings/localSettings';
import { cn } from '@/lib/utils';

import { WriteItBarCreate } from './components/write-it-bar-create';
import { WriteItBarEdit } from './components/write-it-bar-edit';
import { SIDEBAR_DISMISS_KEY, TOP_BANNER_DISMISS_KEY } from './constants';
import type { PostingAction, PostingPopoverView, WriteItBarProps } from './types';
import { formatScheduledAtLabel, isDismissedWithinTtl } from './utils';

export function WriteItBar(props: WriteItBarProps) {
  const [scheduleLimitDismissed, setScheduleLimitDismissed] = useState<boolean>(() => {
    return (
      isDismissedWithinTtl(TOP_BANNER_DISMISS_KEY) || isDismissedWithinTtl(SIDEBAR_DISMISS_KEY)
    );
  });

  const prevModeRef = useRef(props.mode);
  const postingActionManuallySetRef = useRef(false);
  const [postingAction, setPostingAction] = useState<PostingAction>(() => {
    const hasSchedule = Boolean(props.scheduledAt && props.scheduledAt.trim());
    return hasSchedule ? 'datetime' : 'queue';
  });
  const [postingPopoverOpen, setPostingPopoverOpen] = useState(false);
  const [postingPopoverView, setPostingPopoverView] = useState<PostingPopoverView>('menu');

  const setPostingActionManual = (next: PostingAction) => {
    postingActionManuallySetRef.current = true;
    setPostingAction(next);
  };

  useEffect(() => {
    if (prevModeRef.current === props.mode) return;
    prevModeRef.current = props.mode;
    const hasSchedule = Boolean(props.scheduledAt && props.scheduledAt.trim());
    setPostingAction(hasSchedule ? 'datetime' : 'queue');
    setPostingPopoverOpen(false);
    setPostingPopoverView('menu');
    postingActionManuallySetRef.current = false;
  }, [props.mode, props.scheduledAt]);

  useEffect(() => {
    if (props.mode !== 'create') return;
    if (postingActionManuallySetRef.current) return;
    const hasSchedule = Boolean(props.scheduledAt && props.scheduledAt.trim());
    setPostingAction(hasSchedule ? 'datetime' : 'queue');
  }, [props.mode, props.scheduledAt]);

  const scheduledAtLabel = useMemo(
    () =>
      props.scheduledAt ? formatScheduledAtLabel(props.scheduledAt, props.brandTimezone) : null,
    [props.brandTimezone, props.scheduledAt]
  );

  const handleEditPrimaryAction = async () => {
    if (props.mode !== 'edit') return;

    if (postingAction === 'now') {
      if (!props.onPublishNow) return;
      if (props.publishNowDisabled || props.isPublishingNow || !props.validationOk) return;

      if (props.hasChanges) {
        const result = await props.onSave();
        if (result === false) return;
      }

      props.onPublishNow();
      return;
    }

    if (props.hasChanges) {
      props.onSave();
      return;
    }

    if (
      postingAction === 'queue' &&
      props.onAddToQueue &&
      !props.queueDisabled &&
      props.validationOk &&
      !props.isQueueing
    ) {
      props.onAddToQueue();
      return;
    }

    props.onSave();
  };

  const outerClass = cn(
    'border-border bg-card border-t pb-3',
    props.mode === 'edit' ? 'pl-2 pr-4' : 'px-4',
    props.previewHandle ? 'pt-8' : 'pt-3',
    props.layout === 'sidebar' && 'sticky bottom-0 z-20',
    props.previewHandle && 'relative'
  );

  return (
    <div className={outerClass}>
      {props.previewHandle ? (
        <div className="absolute -top-5 right-4 z-10">{props.previewHandle}</div>
      ) : null}

      {props.mode === 'create' ? (
        <WriteItBarCreate
          barProps={props}
          scheduleLimitDismissed={scheduleLimitDismissed}
          onScheduleLimitDismiss={() => {
            try {
              setLocalSetting<number>(SIDEBAR_DISMISS_KEY, Date.now());
            } catch {}
            setScheduleLimitDismissed(true);
          }}
          postingAction={postingAction}
          scheduledAtLabel={scheduledAtLabel}
          postingPopoverOpen={postingPopoverOpen}
          postingPopoverView={postingPopoverView}
          setPostingPopoverOpen={setPostingPopoverOpen}
          setPostingPopoverView={setPostingPopoverView}
          setPostingActionManual={setPostingActionManual}
        />
      ) : (
        <WriteItBarEdit
          barProps={props}
          postingAction={postingAction}
          scheduledAtLabel={scheduledAtLabel}
          postingPopoverOpen={postingPopoverOpen}
          postingPopoverView={postingPopoverView}
          setPostingPopoverOpen={setPostingPopoverOpen}
          setPostingPopoverView={setPostingPopoverView}
          setPostingActionManual={setPostingActionManual}
          onEditPrimaryAction={handleEditPrimaryAction}
        />
      )}
    </div>
  );
}
