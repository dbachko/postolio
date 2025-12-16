import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
import { AlertTriangle, ChevronDown, Clock, Save } from 'lucide-react';

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
      validationOk: boolean;
      onScheduledAtChange: (value: string) => void;
      onSchedule: () => void;
      onSaveDraft: () => void;
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
      onScheduledAtChange: (value: string) => void;
      onUnschedule: () => void;
      onSave: () => void;
    };

export function WriteItBar(props: WriteItBarProps) {
  const outerClass = cn(
    'border-border bg-card border-t px-4 py-3',
    props.layout === 'sidebar' && 'sticky bottom-0 z-20'
  );

  return (
    <div className={outerClass}>
      {props.mode === 'create' ? (
        <div className="space-y-3">
          {props.atCapacity && (
            <div className="bg-muted border-border text-foreground flex items-start gap-2 rounded-md border p-3 text-xs">
              <AlertTriangle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">
                  You&apos;ve reached your plan&apos;s scheduling limit.
                </p>
                <p className="text-muted-foreground">
                  You can still save drafts, but new scheduled posts will fail until you free up
                  slots or{' '}
                  <button
                    type="button"
                    onClick={() => (props.onUpgradePlan ? props.onUpgradePlan() : null)}
                    className="font-medium underline underline-offset-2"
                  >
                    upgrade your plan
                  </button>
                  .
                </p>
              </div>
            </div>
          )}

          <TooltipProvider>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-1 items-center gap-2">
                <Clock className="text-muted-foreground h-4 w-4" />
                <Input
                  type="datetime-local"
                  value={props.scheduledAt}
                  onChange={(e) => props.onScheduledAtChange(e.target.value)}
                  min={props.minScheduleInput}
                  className="h-9 max-w-[220px]"
                />
                {props.brandTimezone ? (
                  <span className="text-muted-foreground text-xs">({props.brandTimezone})</span>
                ) : null}
              </div>

              <div className="flex items-center justify-end">
                <ButtonGroup>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={props.onSchedule}
                        disabled={props.createScheduleDisabled}
                        aria-disabled={props.createScheduleDisabled}
                        className={cn(props.createScheduleDisabled && 'cursor-not-allowed')}
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

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="default"
                        className="!px-2"
                        aria-label="More scheduling options"
                        disabled={props.isCreatingPost}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem
                        onClick={() => {
                          if (props.isCreatingPost || !props.validationOk) return;
                          props.onSaveDraft();
                        }}
                        disabled={props.isCreatingPost || !props.validationOk}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        Save draft
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ButtonGroup>
              </div>
            </div>
          </TooltipProvider>
        </div>
      ) : (
        <TooltipProvider>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-2">
              <Clock className="text-muted-foreground h-4 w-4" />
              <Input
                type="datetime-local"
                value={props.scheduledAt}
                onChange={(e) => props.onScheduledAtChange(e.target.value)}
                min={props.minScheduleInput}
                className="h-9 max-w-[220px]"
              />
              {props.brandTimezone ? (
                <span className="text-muted-foreground text-xs">({props.brandTimezone})</span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {props.isScheduled ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={props.isUnscheduling}>
                      <Clock className="mr-2 h-4 w-4" />
                      Unschedule to Draft
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

              <Button
                onClick={props.onSave}
                disabled={!props.hasChanges || props.isSaving || !props.validationOk}
              >
                {props.isSaving ? (
                  <>
                    <Save className="mr-2 h-4 w-4 animate-pulse" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    {props.primaryEditCtaLabel}
                  </>
                )}
              </Button>
            </div>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}
