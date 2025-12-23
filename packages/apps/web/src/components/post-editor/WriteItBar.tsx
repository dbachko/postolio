import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { addHours, format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getLocalSetting, setLocalSetting } from '@/lib/settings/localSettings';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { getTimezoneAbbr, toUTCFromInput } from '@/lib/timezone';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  ListPlus,
  Save,
  X,
  Zap,
} from 'lucide-react';

const DISMISS_TTL_DAYS = 7;
const TOP_BANNER_DISMISS_KEY = 'schedule-limit-banner-dismissed-at';
const SIDEBAR_DISMISS_KEY = 'schedule-limit-writeitbar-dismissed-at';

type PostingAction = 'queue' | 'datetime' | 'now';
type PostingPopoverView = 'menu' | 'datetime';

function isDismissedWithinTtl(key: string): boolean {
  try {
    const ts = getLocalSetting<number>(key);
    if (!ts || !Number.isFinite(ts)) return false;
    const ageMs = Date.now() - ts;
    return ageMs < DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function normalizeScheduledAtInput(value: string): { datePart: string; timePart: string } | null {
  const trimmed = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(trimmed);
  if (!match) return null;
  return { datePart: match[1]!, timePart: match[2]! };
}

function getDefaultScheduledAtInput(timezone?: string): string {
  const next = addHours(new Date(), 1);
  if (timezone) return formatInTimeZone(next, timezone, "yyyy-MM-dd'T'HH:mm");
  return format(next, "yyyy-MM-dd'T'HH:mm");
}

function formatScheduledAtLabel(value: string, timezone?: string): string | null {
  if (!timezone) return null;
  const parts = normalizeScheduledAtInput(value);
  if (!parts) return null;
  try {
    const utc = toUTCFromInput(`${parts.datePart}T${parts.timePart}`, timezone);
    const label = formatInTimeZone(utc, timezone, 'MMM d, h:mm a');
    const tzAbbr = getTimezoneAbbr(timezone);
    return `${label} ${tzAbbr}`;
  } catch {
    return null;
  }
}

function getPostingActionLabel(action: PostingAction): string {
  if (action === 'queue') return 'Next available';
  if (action === 'now') return 'Now';
  return 'Set date and time';
}

type WriteItBarLayout = 'sidebar' | 'page';

type WriteItBarProps =
  | {
      mode: 'create';
      layout: WriteItBarLayout;
      scheduledAt: string;
      minScheduleInput: string;
      brandTimezone?: string;
      atCapacity: boolean;
      scheduleBlocker: string | null;
      createScheduleDisabled: boolean;
      isCreatingPost: boolean;
      saveDraftDisabled: boolean;
      saveDraftBlocker: string | null;
      publishNowDisabled: boolean;
      publishNowBlocker: string | null;
      previewHandle?: ReactNode;
      onScheduledAtChange: (value: string) => void;
      onSchedule: () => void;
      onSaveDraft: () => void;
      onAddToQueue: () => void;
      onPublishNow: () => void;
      queueDisabled: boolean;
      queueBlocker: string | null;
      onPickSlot: () => void;
      pickSlotDisabled: boolean;
      pickSlotBlocker: string | null;
      onUpgradePlan?: () => void;
    }
  | {
      mode: 'edit';
      layout: WriteItBarLayout;
      scheduledAt: string;
      minScheduleInput: string;
      brandTimezone?: string;
      isScheduled: boolean;
      hasChanges: boolean;
      isSaving: boolean;
      isUnscheduling: boolean;
      validationOk: boolean;
      primaryEditCtaLabel: string;
      previewHandle?: ReactNode;
      onScheduledAtChange: (value: string) => void;
      onUnschedule: () => void;
      onSave: () => void;
      onAddToQueue?: () => void;
      queueDisabled?: boolean;
      isQueueing?: boolean;
    };

export function WriteItBar(props: WriteItBarProps) {
  const [scheduleLimitDismissed, setScheduleLimitDismissed] = useState<boolean>(() => {
    return (
      isDismissedWithinTtl(TOP_BANNER_DISMISS_KEY) || isDismissedWithinTtl(SIDEBAR_DISMISS_KEY)
    );
  });

  const [postingAction, setPostingAction] = useState<PostingAction>(() => {
    const hasSchedule = Boolean(props.scheduledAt && props.scheduledAt.trim());
    return hasSchedule ? 'datetime' : 'queue';
  });
  const [postingPopoverOpen, setPostingPopoverOpen] = useState(false);
  const [postingPopoverView, setPostingPopoverView] = useState<PostingPopoverView>('menu');

  useEffect(() => {
    const hasSchedule = Boolean(props.scheduledAt && props.scheduledAt.trim());
    setPostingAction(hasSchedule ? 'datetime' : 'queue');
    setPostingPopoverOpen(false);
    setPostingPopoverView('menu');
  }, [props.mode]);

  useEffect(() => {
    if (!props.scheduledAt) return;
    if (postingAction === 'datetime') return;
    setPostingAction('datetime');
  }, [postingAction, props.scheduledAt]);

  const scheduledAtLabel = useMemo(
    () =>
      props.scheduledAt ? formatScheduledAtLabel(props.scheduledAt, props.brandTimezone) : null,
    [props.brandTimezone, props.scheduledAt]
  );

  const handleEditPrimaryAction = () => {
    if (props.mode !== 'edit') return;

    if (props.hasChanges) {
      props.onSave();
      return;
    }

    if (
      postingAction === 'queue' &&
      props.onAddToQueue &&
      !props.isScheduled &&
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
    'border-border bg-card border-t px-4 pb-3',
    props.previewHandle ? 'pt-8' : 'pt-3',
    props.layout === 'sidebar' && 'sticky bottom-0 z-20',
    props.previewHandle && 'relative'
  );

  const renderPostingMenu = (opts: {
    mode: 'create' | 'edit';
    onSetQueue: () => void;
    onSetNow?: () => void;
    onOpenDateTime: () => void;
    onPickSlot?: (() => void) | null;
    pickSlotDisabled?: boolean;
    pickSlotBlocker?: string | null;
    queueDisabled?: boolean;
    queueBlocker?: string | null;
    nowDisabled?: boolean;
    nowBlocker?: string | null;
  }) => {
    const queueBlocked = Boolean(opts.queueDisabled && opts.queueBlocker);
    const slotBlocked = Boolean(opts.pickSlotDisabled && opts.pickSlotBlocker);
    const nowBlocked = Boolean(opts.nowDisabled && opts.nowBlocker);
    const showNow = Boolean(opts.onSetNow);

    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Posting</div>
          <div className="text-muted-foreground text-xs">
            Choose how this post should be published.
          </div>
        </div>

        <div className="space-y-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-auto w-full items-start justify-start gap-3 rounded-md p-2 text-left',
              postingAction === 'queue' && 'bg-muted',
              opts.queueDisabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
            )}
            disabled={Boolean(opts.queueDisabled)}
            onClick={() => {
              if (opts.queueDisabled) return;
              opts.onSetQueue();
              setPostingAction('queue');
              setPostingPopoverOpen(false);
              setPostingPopoverView('menu');
            }}
          >
            <div className="mt-0.5 flex h-5 w-5 items-center justify-center">
              {postingAction === 'queue' ? (
                <Check className="h-4 w-4" />
              ) : (
                <ListPlus className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">Next available</div>
              <div className="text-muted-foreground text-xs">
                Use the next available posting slot in your queue.
              </div>
            </div>
          </Button>

          {showNow ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-auto w-full items-start justify-start gap-3 rounded-md p-2 text-left',
                postingAction === 'now' && 'bg-muted',
                opts.nowDisabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
              )}
              disabled={Boolean(opts.nowDisabled)}
              onClick={() => {
                if (opts.nowDisabled) return;
                opts.onSetNow?.();
                setPostingAction('now');
                setPostingPopoverOpen(false);
                setPostingPopoverView('menu');
              }}
            >
              <div className="mt-0.5 flex h-5 w-5 items-center justify-center">
                {postingAction === 'now' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">Now</div>
                <div className="text-muted-foreground text-xs">Publish your post right away.</div>
              </div>
            </Button>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-auto w-full items-start justify-start gap-3 rounded-md p-2 text-left',
              postingAction === 'datetime' && 'bg-muted'
            )}
            onClick={() => {
              setPostingAction('datetime');
              opts.onOpenDateTime();
            }}
          >
            <div className="mt-0.5 flex h-5 w-5 items-center justify-center">
              {postingAction === 'datetime' ? (
                <Check className="h-4 w-4" />
              ) : (
                <CalendarClock className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">Set date and time</div>
              <div className="text-muted-foreground text-xs">Choose a specific time to post.</div>
            </div>
          </Button>

          {opts.onPickSlot ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-auto w-full items-start justify-start gap-3 rounded-md p-2 text-left',
                opts.pickSlotDisabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
              )}
              disabled={Boolean(opts.pickSlotDisabled)}
              onClick={() => {
                if (opts.pickSlotDisabled) return;
                setPostingAction('datetime');
                setPostingPopoverOpen(false);
                setPostingPopoverView('menu');
                opts.onPickSlot?.();
              }}
            >
              <div className="mt-0.5 flex h-5 w-5 items-center justify-center">
                <CalendarClock className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">Pick a slot</div>
                <div className="text-muted-foreground text-xs">
                  Choose a recommended time from your weekly calendar.
                </div>
              </div>
            </Button>
          ) : null}
        </div>

        {queueBlocked || slotBlocked || nowBlocked ? (
          <div className="text-muted-foreground bg-background space-y-1 rounded-md border p-2 text-xs">
            {queueBlocked ? (
              <p>
                <span className="text-foreground font-medium">Next available:</span>{' '}
                {opts.queueBlocker}
              </p>
            ) : null}
            {nowBlocked ? (
              <p>
                <span className="text-foreground font-medium">Now:</span> {opts.nowBlocker}
              </p>
            ) : null}
            {slotBlocked ? (
              <p>
                <span className="text-foreground font-medium">Pick a slot:</span>{' '}
                {opts.pickSlotBlocker}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const renderDateTimePicker = (opts: { onDone: () => void; onBack: () => void }) => {
    const timezone = props.brandTimezone;
    const parts =
      props.scheduledAt && normalizeScheduledAtInput(props.scheduledAt)
        ? normalizeScheduledAtInput(props.scheduledAt)!
        : normalizeScheduledAtInput(getDefaultScheduledAtInput(timezone))!;
    const selectedDate = new Date(`${parts.datePart}T12:00:00`);

    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Set date and time</div>
          {timezone ? <div className="text-muted-foreground text-xs">{timezone}</div> : null}
        </div>

        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(d) => {
            if (!d) return;
            const nextDate = format(d, 'yyyy-MM-dd');
            props.onScheduledAtChange(`${nextDate}T${parts.timePart}`);
          }}
        />

        <div className="space-y-2">
          <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Select time
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-background border-border flex flex-1 items-center gap-2 rounded-md border px-3 py-2">
              <Clock className="text-muted-foreground h-4 w-4" />
              <Input
                type="time"
                value={parts.timePart}
                onChange={(e) => {
                  const nextTime = e.target.value;
                  if (!/^\d{2}:\d{2}$/.test(nextTime)) return;
                  props.onScheduledAtChange(`${parts.datePart}T${nextTime}`);
                }}
                className="h-8 border-none bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
            </div>
            {timezone ? (
              <div className="text-muted-foreground hidden text-xs sm:block">{timezone}</div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <Button type="button" variant="ghost" onClick={opts.onBack} className="px-0">
            More posting actions
          </Button>
          <Button type="button" onClick={opts.onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className={outerClass}>
      {props.previewHandle ? (
        <div className="absolute -top-5 right-4 z-10">{props.previewHandle}</div>
      ) : null}
      {props.mode === 'create' ? (
        <div className="space-y-3">
          {props.atCapacity && !scheduleLimitDismissed && (
            <div className="bg-muted border-border text-foreground flex items-start gap-2 rounded-md border p-3 text-xs">
              <AlertTriangle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="flex-1 space-y-1">
                <p className="font-medium">
                  You&apos;ve reached your plan&apos;s scheduling limit.
                </p>
                <p className="text-muted-foreground">
                  You can still save drafts and add posts to your queue, but new scheduled posts
                  will fail until you free up slots or{' '}
                  <Button
                    type="button"
                    onClick={() => (props.onUpgradePlan ? props.onUpgradePlan() : null)}
                    variant="link"
                    className="h-auto p-0 align-baseline font-medium underline underline-offset-2"
                  >
                    upgrade your plan
                  </Button>
                  .
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Dismiss scheduling limit alert"
                className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 shrink-0"
                onClick={() => {
                  try {
                    setLocalSetting<number>(SIDEBAR_DISMISS_KEY, Date.now());
                  } catch {}
                  setScheduleLimitDismissed(true);
                }}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )}

          <TooltipProvider>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (props.saveDraftDisabled) return;
                        props.onSaveDraft();
                      }}
                      disabled={props.isCreatingPost}
                      aria-disabled={props.saveDraftDisabled}
                      className={cn(
                        props.saveDraftDisabled &&
                          !props.isCreatingPost &&
                          'hover:bg-primary cursor-not-allowed opacity-50'
                      )}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      Save draft
                    </Button>
                  </TooltipTrigger>
                  {props.saveDraftBlocker ? (
                    <TooltipContent>
                      <p className="text-sm">{props.saveDraftBlocker}</p>
                    </TooltipContent>
                  ) : null}
                </Tooltip>
              </div>

              <Popover
                open={postingPopoverOpen}
                onOpenChange={(open) => {
                  setPostingPopoverOpen(open);
                  if (!open) setPostingPopoverView('menu');
                }}
              >
                <ButtonGroup className="w-full sm:w-auto">
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-w-0 flex-1 justify-between sm:min-w-[240px] sm:flex-none"
                      disabled={props.isCreatingPost}
                    >
                      <span className="flex items-center gap-2">
                        {postingAction === 'queue' ? (
                          <ListPlus className="h-4 w-4" />
                        ) : postingAction === 'now' ? (
                          <Zap className="h-4 w-4" />
                        ) : (
                          <CalendarClock className="h-4 w-4" />
                        )}
                        <span className="truncate">
                          {postingAction === 'datetime' && scheduledAtLabel
                            ? scheduledAtLabel
                            : getPostingActionLabel(postingAction)}
                        </span>
                      </span>
                      <ChevronDown className="text-muted-foreground size-4" aria-hidden="true" />
                    </Button>
                  </PopoverTrigger>

                  {postingAction === 'queue' ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            if (props.queueDisabled) return;
                            props.onAddToQueue();
                          }}
                          disabled={props.isCreatingPost}
                          aria-disabled={props.queueDisabled}
                          className={cn(
                            props.queueDisabled &&
                              !props.isCreatingPost &&
                              'hover:bg-primary cursor-not-allowed opacity-50'
                          )}
                        >
                          {props.isCreatingPost ? (
                            <>
                              <Clock className="mr-2 h-4 w-4 animate-pulse" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <ListPlus className="mr-2 h-4 w-4" />
                              Add to queue
                            </>
                          )}
                        </Button>
                      </TooltipTrigger>
                      {props.queueBlocker ? (
                        <TooltipContent>
                          <p className="text-sm">{props.queueBlocker}</p>
                        </TooltipContent>
                      ) : null}
                    </Tooltip>
                  ) : postingAction === 'now' ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            if (props.publishNowDisabled) return;
                            props.onPublishNow();
                          }}
                          disabled={props.isCreatingPost}
                          aria-disabled={props.publishNowDisabled}
                          className={cn(
                            props.publishNowDisabled &&
                              !props.isCreatingPost &&
                              'hover:bg-primary cursor-not-allowed opacity-50'
                          )}
                        >
                          {props.isCreatingPost ? (
                            <>
                              <Clock className="mr-2 h-4 w-4 animate-pulse" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <Zap className="mr-2 h-4 w-4" />
                              Publish now
                            </>
                          )}
                        </Button>
                      </TooltipTrigger>
                      {props.publishNowBlocker ? (
                        <TooltipContent>
                          <p className="text-sm">{props.publishNowBlocker}</p>
                        </TooltipContent>
                      ) : null}
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            if (props.createScheduleDisabled) return;
                            props.onSchedule();
                          }}
                          disabled={props.isCreatingPost}
                          aria-disabled={props.createScheduleDisabled}
                          className={cn(
                            props.createScheduleDisabled &&
                              !props.isCreatingPost &&
                              'hover:bg-primary cursor-not-allowed opacity-50'
                          )}
                        >
                          {props.isCreatingPost ? (
                            <>
                              <Clock className="mr-2 h-4 w-4 animate-pulse" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <Clock className="mr-2 h-4 w-4" />
                              Schedule
                            </>
                          )}
                        </Button>
                      </TooltipTrigger>
                      {props.scheduleBlocker ? (
                        <TooltipContent>
                          <p className="text-sm">{props.scheduleBlocker}</p>
                        </TooltipContent>
                      ) : null}
                    </Tooltip>
                  )}
                </ButtonGroup>

                <PopoverContent align="end" className="w-[340px] max-w-[calc(100vw-2rem)] p-3">
                  {postingPopoverView === 'datetime'
                    ? renderDateTimePicker({
                        onBack: () => setPostingPopoverView('menu'),
                        onDone: () => {
                          setPostingPopoverOpen(false);
                          setPostingPopoverView('menu');
                        },
                      })
                    : renderPostingMenu({
                        mode: 'create',
                        onSetQueue: () => props.onScheduledAtChange(''),
                        onSetNow: () => props.onScheduledAtChange(''),
                        onOpenDateTime: () => {
                          if (!props.scheduledAt) {
                            props.onScheduledAtChange(
                              getDefaultScheduledAtInput(props.brandTimezone)
                            );
                          }
                          setPostingPopoverView('datetime');
                        },
                        onPickSlot: props.onPickSlot,
                        pickSlotDisabled: props.isCreatingPost || props.pickSlotDisabled,
                        pickSlotBlocker: props.pickSlotBlocker,
                        queueDisabled: props.queueDisabled,
                        queueBlocker: props.queueBlocker,
                        nowDisabled: props.publishNowDisabled,
                        nowBlocker: props.publishNowBlocker,
                      })}
                </PopoverContent>
              </Popover>
            </div>
          </TooltipProvider>
        </div>
      ) : (
        <TooltipProvider>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {props.isScheduled ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={props.isUnscheduling}>
                      <Clock className="mr-2 h-4 w-4" />
                      Move to Draft
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Unschedule this post?</AlertDialogTitle>
                      <AlertDialogDescription>
                        We’ll cancel the scheduled publish time and move this post back to Drafts.
                        It will no longer publish automatically.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={props.isUnscheduling}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={props.onUnschedule}
                        disabled={props.isUnscheduling}
                      >
                        Unschedule and move to Drafts
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>

            <Popover
              open={postingPopoverOpen}
              onOpenChange={(open) => {
                setPostingPopoverOpen(open);
                if (!open) setPostingPopoverView('menu');
              }}
            >
              <ButtonGroup className="w-full sm:w-auto">
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-w-0 flex-1 justify-between sm:min-w-[240px] sm:flex-none"
                    disabled={props.isSaving || props.isUnscheduling}
                  >
                    <span className="flex items-center gap-2">
                      {postingAction === 'queue' ? (
                        <ListPlus className="h-4 w-4" />
                      ) : (
                        <CalendarClock className="h-4 w-4" />
                      )}
                      <span className="truncate">
                        {postingAction === 'datetime' && scheduledAtLabel
                          ? scheduledAtLabel
                          : getPostingActionLabel(postingAction)}
                      </span>
                    </span>
                    <ChevronDown className="text-muted-foreground size-4" aria-hidden="true" />
                  </Button>
                </PopoverTrigger>

                <Button
                  size="sm"
                  onClick={handleEditPrimaryAction}
                  disabled={
                    props.isSaving ||
                    props.isUnscheduling ||
                    (props.hasChanges && props.isScheduled && !props.validationOk) ||
                    (!props.hasChanges && postingAction !== 'queue') ||
                    (postingAction === 'queue' &&
                      (!props.onAddToQueue ||
                        props.isScheduled ||
                        Boolean(props.queueDisabled) ||
                        props.hasChanges ||
                        !props.validationOk ||
                        props.isQueueing))
                  }
                >
                  {props.isSaving ? (
                    <>Saving...</>
                  ) : props.hasChanges ? (
                    <>{props.primaryEditCtaLabel}</>
                  ) : postingAction === 'queue' ? (
                    <>Add to queue</>
                  ) : (
                    <>{props.primaryEditCtaLabel}</>
                  )}
                </Button>
              </ButtonGroup>

              <PopoverContent align="end" className="w-[340px] max-w-[calc(100vw-2rem)] p-3">
                {postingPopoverView === 'datetime'
                  ? renderDateTimePicker({
                      onBack: () => setPostingPopoverView('menu'),
                      onDone: () => {
                        setPostingPopoverOpen(false);
                        setPostingPopoverView('menu');
                      },
                    })
                  : renderPostingMenu({
                      mode: 'edit',
                      onSetQueue: () => null,
                      onOpenDateTime: () => {
                        if (!props.scheduledAt) {
                          props.onScheduledAtChange(
                            getDefaultScheduledAtInput(props.brandTimezone)
                          );
                        }
                        setPostingPopoverView('datetime');
                      },
                      queueDisabled:
                        !props.onAddToQueue ||
                        props.isScheduled ||
                        Boolean(props.queueDisabled) ||
                        props.hasChanges ||
                        !props.validationOk ||
                        props.isQueueing,
                      queueBlocker: (() => {
                        if (!props.onAddToQueue)
                          return 'Queue scheduling is not available for this post.';
                        if (props.isScheduled)
                          return 'Unschedule this post before adding it to a queue.';
                        if (props.hasChanges) return 'Save your changes before adding to queue.';
                        if (!props.validationOk)
                          return 'Fix validation errors before adding to queue.';
                        return null;
                      })(),
                    })}
              </PopoverContent>
            </Popover>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}
