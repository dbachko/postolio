import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { getPlatformConfig, type Platform } from '@/lib/platform-config';
import { getPlatformIcon } from '@/lib/platform-icons';
import { PostEditorFooterRow } from '@/components/post-editor/PostEditorFooterRow';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  ListPlus,
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

function formatTimezoneLocationLabel(timezone?: string): string | null {
  const trimmed = (timezone || '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split('/').filter(Boolean);
  const last = parts[parts.length - 1] || trimmed;
  const label = last.replaceAll('_', ' ');
  return label || null;
}

function parsePlatformPrefixedMessage(message: string): {
  platform: Platform | null;
  message: string;
} {
  const trimmed = (message || '').trim();
  const match = /^(instagram|facebook|linkedin|x|youtube|tiktok):\s*/i.exec(trimmed);
  if (!match) return { platform: null, message: trimmed };
  const platform = match[1]?.toLowerCase() as Platform;
  const next = trimmed.slice(match[0].length).trim();
  return { platform, message: next || trimmed };
}

function BlockerTooltipMessage({ message }: { message: string }) {
  const parsed = parsePlatformPrefixedMessage(message);
  const icon = parsed.platform ? getPlatformIcon(parsed.platform, 'h-4 w-4') : null;
  const color = (() => {
    if (!parsed.platform) return null;
    try {
      return getPlatformConfig(parsed.platform).color;
    } catch {
      return null;
    }
  })();

  if (!icon) return <p className="text-sm">{parsed.message}</p>;

  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5" style={color ? { color } : undefined}>
        {icon}
      </span>
      <p className="text-sm">{parsed.message}</p>
    </div>
  );
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
      leadingActions?: ReactNode;
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
      leadingActions?: ReactNode;
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
      onSave: () => void | Promise<boolean>;
      onAddToQueue?: () => void;
      queueDisabled?: boolean;
      isQueueing?: boolean;
      onPublishNow?: () => void;
      publishNowDisabled?: boolean;
      publishNowBlocker?: string | null;
      isPublishingNow?: boolean;
      onPickSlot?: () => void;
      pickSlotDisabled?: boolean;
      pickSlotBlocker?: string | null;
    };

export function WriteItBar(props: WriteItBarProps) {
  const [scheduleLimitDismissed, setScheduleLimitDismissed] = useState<boolean>(() => {
    return (
      isDismissedWithinTtl(TOP_BANNER_DISMISS_KEY) || isDismissedWithinTtl(SIDEBAR_DISMISS_KEY)
    );
  });

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
    const hasSchedule = Boolean(props.scheduledAt && props.scheduledAt.trim());
    setPostingAction(hasSchedule ? 'datetime' : 'queue');
    setPostingPopoverOpen(false);
    setPostingPopoverView('menu');
    postingActionManuallySetRef.current = false;
  }, [props.mode]);

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

  const renderPostingMenu = (opts: {
    mode: 'create' | 'edit';
    onSetNow?: () => void;
    onOpenDateTime: () => void;
    onPickSlot?: (() => void) | null;
    pickSlotDisabled?: boolean;
    pickSlotBlocker?: string | null;
  }) => {
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
              'h-auto w-full items-start justify-start gap-3 rounded-md p-2 text-left whitespace-normal',
              postingAction === 'queue' && 'bg-muted'
            )}
            onClick={() => {
              setPostingActionManual('queue');
              if (props.mode === 'create') props.onScheduledAtChange('');
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
                'h-auto w-full items-start justify-start gap-3 rounded-md p-2 text-left whitespace-normal',
                postingAction === 'now' && 'bg-muted'
              )}
              onClick={() => {
                setPostingActionManual('now');
                if (props.mode === 'create') props.onScheduledAtChange('');
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
              'h-auto w-full items-start justify-start gap-3 rounded-md p-2 text-left whitespace-normal',
              postingAction === 'datetime' && 'bg-muted'
            )}
            onClick={() => {
              setPostingActionManual('datetime');
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
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <span className="block w-full">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-auto w-full items-start justify-start gap-3 rounded-md p-2 text-left whitespace-normal',
                      opts.pickSlotDisabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
                    )}
                    disabled={Boolean(opts.pickSlotDisabled)}
                    onClick={() => {
                      if (opts.pickSlotDisabled) return;
                      setPostingActionManual('datetime');
                      setPostingPopoverOpen(false);
                      setPostingPopoverView('menu');
                      opts.onPickSlot?.();
                    }}
                  >
                    <div className="mt-0.5 flex h-5 w-5 items-center justify-center">
                      <CalendarClock className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">Pick a slot</div>
                      <div className="text-muted-foreground text-xs">
                        Choose a recommended time from your publishing schedule.
                      </div>
                    </div>
                  </Button>
                </span>
              </TooltipTrigger>
              {opts.pickSlotDisabled ? (
                <TooltipContent>
                  {opts.pickSlotBlocker ? (
                    <BlockerTooltipMessage message={opts.pickSlotBlocker} />
                  ) : (
                    <p className="text-sm">This option is not available right now.</p>
                  )}
                </TooltipContent>
              ) : null}
            </Tooltip>
          ) : null}
        </div>
      </div>
    );
  };

  const renderDateTimePicker = (opts: { onDone: () => void; onBack: () => void }) => {
    const timezone = props.brandTimezone;
    const timezoneLabel = formatTimezoneLocationLabel(timezone);
    const parts =
      props.scheduledAt && normalizeScheduledAtInput(props.scheduledAt)
        ? normalizeScheduledAtInput(props.scheduledAt)!
        : normalizeScheduledAtInput(getDefaultScheduledAtInput(timezone))!;
    const selectedDate = new Date(`${parts.datePart}T12:00:00`);

    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Set date and time</div>
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
          <div className="flex items-center justify-between gap-2">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Select time
            </div>
            {timezoneLabel ? (
              <div className="bg-muted border-border text-foreground rounded-full border px-2 py-0.5 text-xs font-medium">
                {timezoneLabel}
              </div>
            ) : null}
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
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={opts.onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            More actions
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
            <PostEditorFooterRow
              leading={props.leadingActions}
              left={
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
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
                          'hover:text-foreground cursor-not-allowed opacity-50 hover:bg-transparent'
                      )}
                    >
                      Save draft
                    </Button>
                  </TooltipTrigger>
                  {props.saveDraftBlocker ? (
                    <TooltipContent>
                      <p className="text-sm">{props.saveDraftBlocker}</p>
                    </TooltipContent>
                  ) : null}
                </Tooltip>
              }
              right={
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
                        className="min-w-0 flex-1 justify-between sm:flex-none"
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
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              if (props.isCreatingPost) return;
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
                            {props.isCreatingPost ? <>Creating...</> : <>Add to queue</>}
                          </Button>
                        </TooltipTrigger>
                        {props.queueBlocker ? (
                          <TooltipContent>
                            <BlockerTooltipMessage message={props.queueBlocker} />
                          </TooltipContent>
                        ) : null}
                      </Tooltip>
                    ) : postingAction === 'now' ? (
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              if (props.isCreatingPost) return;
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
                            {props.isCreatingPost ? <>Creating...</> : <>Publish</>}
                          </Button>
                        </TooltipTrigger>
                        {props.publishNowBlocker ? (
                          <TooltipContent>
                            <BlockerTooltipMessage message={props.publishNowBlocker} />
                          </TooltipContent>
                        ) : null}
                      </Tooltip>
                    ) : (
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              if (props.isCreatingPost) return;
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
                            {props.isCreatingPost ? <>Creating...</> : <>Schedule</>}
                          </Button>
                        </TooltipTrigger>
                        {props.scheduleBlocker ? (
                          <TooltipContent>
                            <BlockerTooltipMessage message={props.scheduleBlocker} />
                          </TooltipContent>
                        ) : null}
                      </Tooltip>
                    )}
                  </ButtonGroup>

                  <PopoverContent
                    align="end"
                    className={cn(
                      postingPopoverView === 'datetime' ? 'w-fit' : 'w-[340px]',
                      'max-w-[calc(100vw-2rem)] p-3'
                    )}
                  >
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
                          onSetNow: () => null,
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
                        })}
                  </PopoverContent>
                </Popover>
              }
            />
          </TooltipProvider>
        </div>
      ) : (
        <TooltipProvider>
          <PostEditorFooterRow
            leading={props.leadingActions}
            left={
              props.isScheduled ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" disabled={props.isUnscheduling}>
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
              ) : (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={props.isSaving || props.isUnscheduling}
                      aria-disabled={!props.hasChanges}
                      className={cn(
                        !props.hasChanges &&
                          !props.isSaving &&
                          !props.isUnscheduling &&
                          'hover:text-foreground cursor-not-allowed opacity-50 hover:bg-transparent'
                      )}
                      onClick={() => {
                        if (props.isSaving || props.isUnscheduling) return;
                        if (!props.hasChanges) return;
                        props.onSave();
                      }}
                    >
                      Save draft
                    </Button>
                  </TooltipTrigger>
                  {!props.hasChanges ? (
                    <TooltipContent>
                      <p className="text-sm">No changes to save.</p>
                    </TooltipContent>
                  ) : null}
                </Tooltip>
              )
            }
            right={
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
                      className="min-w-0 flex-1 justify-between sm:flex-none"
                      disabled={props.isSaving || props.isUnscheduling}
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

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        onClick={() => {
                          const blocked =
                            (props.hasChanges && props.isScheduled && !props.validationOk) ||
                            (!props.hasChanges &&
                              postingAction !== 'queue' &&
                              postingAction !== 'now') ||
                            (postingAction === 'now' &&
                              (!props.onPublishNow ||
                                Boolean(props.publishNowDisabled) ||
                                !props.validationOk ||
                                props.isPublishingNow)) ||
                            (postingAction === 'queue' &&
                              (!props.onAddToQueue ||
                                Boolean(props.queueDisabled) ||
                                props.hasChanges ||
                                !props.validationOk ||
                                props.isQueueing));
                          if (props.isSaving || props.isUnscheduling) return;
                          if (blocked) return;
                          void handleEditPrimaryAction();
                        }}
                        disabled={props.isSaving || props.isUnscheduling}
                        aria-disabled={
                          (props.hasChanges && props.isScheduled && !props.validationOk) ||
                          (!props.hasChanges &&
                            postingAction !== 'queue' &&
                            postingAction !== 'now') ||
                          (postingAction === 'now' &&
                            (!props.onPublishNow ||
                              Boolean(props.publishNowDisabled) ||
                              !props.validationOk ||
                              props.isPublishingNow)) ||
                          (postingAction === 'queue' &&
                            (!props.onAddToQueue ||
                              Boolean(props.queueDisabled) ||
                              props.hasChanges ||
                              !props.validationOk ||
                              props.isQueueing))
                        }
                        className={cn(
                          ((props.hasChanges && props.isScheduled && !props.validationOk) ||
                            (!props.hasChanges &&
                              postingAction !== 'queue' &&
                              postingAction !== 'now') ||
                            (postingAction === 'now' &&
                              (!props.onPublishNow ||
                                Boolean(props.publishNowDisabled) ||
                                !props.validationOk ||
                                props.isPublishingNow)) ||
                            (postingAction === 'queue' &&
                              (!props.onAddToQueue ||
                                Boolean(props.queueDisabled) ||
                                props.hasChanges ||
                                !props.validationOk ||
                                props.isQueueing))) &&
                            !props.isSaving &&
                            !props.isUnscheduling &&
                            'hover:bg-primary cursor-not-allowed opacity-50'
                        )}
                      >
                        {props.isPublishingNow ? (
                          <>Publishing...</>
                        ) : props.isSaving ? (
                          <>Saving...</>
                        ) : props.hasChanges ? (
                          postingAction === 'now' ? (
                            <>Save &amp; publish</>
                          ) : (
                            <>{props.primaryEditCtaLabel}</>
                          )
                        ) : postingAction === 'queue' ? (
                          <>Add to queue</>
                        ) : postingAction === 'now' ? (
                          <>Publish</>
                        ) : (
                          <>{props.primaryEditCtaLabel}</>
                        )}
                      </Button>
                    </TooltipTrigger>
                    {(() => {
                      if (props.isSaving || props.isUnscheduling) return null;
                      if (props.hasChanges) {
                        if (postingAction === 'now' && props.publishNowBlocker) {
                          return (
                            <TooltipContent>
                              <BlockerTooltipMessage message={props.publishNowBlocker} />
                            </TooltipContent>
                          );
                        }
                        if (props.isScheduled && !props.validationOk) {
                          return (
                            <TooltipContent>
                              <p className="text-sm">Fix validation errors before saving.</p>
                            </TooltipContent>
                          );
                        }
                        return null;
                      }

                      if (postingAction === 'now') {
                        if (props.publishNowBlocker) {
                          return (
                            <TooltipContent>
                              <BlockerTooltipMessage message={props.publishNowBlocker} />
                            </TooltipContent>
                          );
                        }
                        if (!props.onPublishNow || Boolean(props.publishNowDisabled)) {
                          return (
                            <TooltipContent>
                              <p className="text-sm">Publishing is not available for this post.</p>
                            </TooltipContent>
                          );
                        }
                        return null;
                      }

                      if (postingAction !== 'queue') {
                        return (
                          <TooltipContent>
                            <p className="text-sm">No changes to save.</p>
                          </TooltipContent>
                        );
                      }

                      if (!props.onAddToQueue || Boolean(props.queueDisabled)) {
                        return (
                          <TooltipContent>
                            <p className="text-sm">
                              Queue scheduling is not available for this post.
                            </p>
                          </TooltipContent>
                        );
                      }

                      if (!props.validationOk) {
                        return (
                          <TooltipContent>
                            <p className="text-sm">Fix validation errors before adding to queue.</p>
                          </TooltipContent>
                        );
                      }

                      return null;
                    })()}
                  </Tooltip>
                </ButtonGroup>

                <PopoverContent
                  align="end"
                  className={cn(
                    postingPopoverView === 'datetime' ? 'w-fit' : 'w-[340px]',
                    'max-w-[calc(100vw-2rem)] p-3'
                  )}
                >
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
                        onSetNow: props.onPublishNow ? () => null : undefined,
                        onOpenDateTime: () => {
                          if (!props.scheduledAt) {
                            props.onScheduledAtChange(
                              getDefaultScheduledAtInput(props.brandTimezone)
                            );
                          }
                          setPostingPopoverView('datetime');
                        },
                        onPickSlot: props.onPickSlot ?? null,
                        pickSlotDisabled:
                          props.isSaving || props.isUnscheduling || Boolean(props.pickSlotDisabled),
                        pickSlotBlocker: props.pickSlotBlocker,
                      })}
                </PopoverContent>
              </Popover>
            }
          />
        </TooltipProvider>
      )}
    </div>
  );
}
