import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import type { PostingGoalValue, QueueToDelete } from './types';

export interface PublishingScheduleDialogsProps {
  queueToDelete: QueueToDelete | null;
  onQueueToDeleteChange: (queue: QueueToDelete | null) => void;
  deleteQueuePending: boolean;
  onConfirmDeleteQueue: (queue: QueueToDelete) => void;
  postingGoalOpen: boolean;
  onPostingGoalOpenChange: (open: boolean) => void;
  postingGoalValue: PostingGoalValue;
  onPostingGoalValueChange: (value: PostingGoalValue) => void;
  postingGoalCustomValue: string;
  onPostingGoalCustomValueChange: (value: string) => void;
  postingGoalCustomError: string | null;
  requiresPostingGoalReplaceConfirm: boolean;
  selectedQueueSlotCount: number;
  postingGoalConfirmReplace: boolean;
  onPostingGoalConfirmReplaceChange: (value: boolean) => void;
  applyPostingGoalPending: boolean;
  canApplyPostingGoal: boolean;
  onApplyPostingGoal: () => void;
}

function GoalOption({
  value,
  selected,
  prefix,
  title,
  subtitle,
}: {
  value: PostingGoalValue;
  selected: boolean;
  prefix: string;
  title: string;
  subtitle: string;
}) {
  return (
    <label
      className={cn(
        'border-border hover:bg-accent/40 flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 transition-colors',
        selected ? 'border-primary bg-primary/5' : ''
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5 pr-3">
        <div className="text-muted-foreground shrink-0 text-xs leading-5 font-medium whitespace-nowrap">
          {prefix}
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm leading-5 font-medium">{title}</div>
          <div className="text-muted-foreground text-xs leading-4">{subtitle}</div>
        </div>
      </div>
      <RadioGroupItem value={value} />
    </label>
  );
}

function PostingGoalPresetOptions({
  postingGoalValue,
  onPostingGoalValueChange,
}: {
  postingGoalValue: PostingGoalValue;
  onPostingGoalValueChange: (value: PostingGoalValue) => void;
}) {
  return (
    <RadioGroup
      value={postingGoalValue}
      onValueChange={(value) => onPostingGoalValueChange(value as PostingGoalValue)}
    >
      <GoalOption
        value="1"
        selected={postingGoalValue === '1'}
        prefix="🌱 1x/week"
        title="Starter pace"
        subtitle="Light and consistent"
      />
      <GoalOption
        value="3"
        selected={postingGoalValue === '3'}
        prefix="📈 3x/week"
        title="Steady pace"
        subtitle="Balanced weekly cadence"
      />
      <GoalOption
        value="5"
        selected={postingGoalValue === '5'}
        prefix="🚀 5x/week"
        title="High pace"
        subtitle="Higher weekly volume"
      />
      <GoalOption
        value="custom"
        selected={postingGoalValue === 'custom'}
        prefix="🎯 Custom"
        title="Custom pace"
        subtitle="Choose your exact weekly volume"
      />
    </RadioGroup>
  );
}

function PostingGoalReplaceWarning({
  selectedQueueSlotCount,
  postingGoalConfirmReplace,
  onPostingGoalConfirmReplaceChange,
}: {
  selectedQueueSlotCount: number;
  postingGoalConfirmReplace: boolean;
  onPostingGoalConfirmReplaceChange: (value: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <Alert variant="warning" className="py-3">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Current schedule will be replaced</AlertTitle>
        <AlertDescription>
          This queue currently has {selectedQueueSlotCount} slot
          {selectedQueueSlotCount === 1 ? '' : 's'}. Applying cadence replaces those slots with a
          new schedule.
        </AlertDescription>
      </Alert>
      <label
        htmlFor="posting-goal-replace-confirm"
        className="flex cursor-pointer items-start gap-2"
      >
        <Checkbox
          id="posting-goal-replace-confirm"
          checked={postingGoalConfirmReplace}
          onCheckedChange={(checked) => onPostingGoalConfirmReplaceChange(Boolean(checked))}
        />
        <span className="text-sm">I understand and want to replace existing slots.</span>
      </label>
    </div>
  );
}

function PostingGoalCustomInput({
  postingGoalCustomValue,
  onPostingGoalCustomValueChange,
  postingGoalCustomError,
}: {
  postingGoalCustomValue: string;
  onPostingGoalCustomValueChange: (value: string) => void;
  postingGoalCustomError: string | null;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="posting-goal-custom">Slots per week</Label>
      <Input
        id="posting-goal-custom"
        type="number"
        min={1}
        max={21}
        step={1}
        value={postingGoalCustomValue}
        onChange={(event) => onPostingGoalCustomValueChange(event.target.value)}
      />
      {postingGoalCustomError ? (
        <p className="text-destructive text-xs">{postingGoalCustomError}</p>
      ) : (
        <p className="text-muted-foreground text-xs">Allowed range: 1 to 21 slots/week.</p>
      )}
    </div>
  );
}

function PostingGoalDialog({
  postingGoalOpen,
  onPostingGoalOpenChange,
  postingGoalValue,
  onPostingGoalValueChange,
  postingGoalCustomValue,
  onPostingGoalCustomValueChange,
  postingGoalCustomError,
  requiresPostingGoalReplaceConfirm,
  selectedQueueSlotCount,
  postingGoalConfirmReplace,
  onPostingGoalConfirmReplaceChange,
  applyPostingGoalPending,
  canApplyPostingGoal,
  onApplyPostingGoal,
}: Omit<
  PublishingScheduleDialogsProps,
  'queueToDelete' | 'onQueueToDeleteChange' | 'deleteQueuePending' | 'onConfirmDeleteQueue'
>) {
  return (
    <Dialog open={postingGoalOpen} onOpenChange={onPostingGoalOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Plan weekly cadence</DialogTitle>
          <DialogDescription>
            Pick how often this queue should publish each week. We&apos;ll add open slots
            automatically.
          </DialogDescription>
        </DialogHeader>
        <PostingGoalPresetOptions
          postingGoalValue={postingGoalValue}
          onPostingGoalValueChange={onPostingGoalValueChange}
        />
        {requiresPostingGoalReplaceConfirm ? (
          <PostingGoalReplaceWarning
            selectedQueueSlotCount={selectedQueueSlotCount}
            postingGoalConfirmReplace={postingGoalConfirmReplace}
            onPostingGoalConfirmReplaceChange={onPostingGoalConfirmReplaceChange}
          />
        ) : null}
        {postingGoalValue === 'custom' ? (
          <PostingGoalCustomInput
            postingGoalCustomValue={postingGoalCustomValue}
            onPostingGoalCustomValueChange={onPostingGoalCustomValueChange}
            postingGoalCustomError={postingGoalCustomError}
          />
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={applyPostingGoalPending}
            onClick={() => onPostingGoalOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={applyPostingGoalPending || !canApplyPostingGoal}
            onClick={onApplyPostingGoal}
          >
            {applyPostingGoalPending ? 'Applying…' : 'Apply cadence'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteQueueDialog({
  queueToDelete,
  onQueueToDeleteChange,
  deleteQueuePending,
  onConfirmDeleteQueue,
}: Pick<
  PublishingScheduleDialogsProps,
  'queueToDelete' | 'onQueueToDeleteChange' | 'deleteQueuePending' | 'onConfirmDeleteQueue'
>) {
  return (
    <AlertDialog
      open={Boolean(queueToDelete)}
      onOpenChange={(open) => (!open ? onQueueToDeleteChange(null) : null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete queue</AlertDialogTitle>
          <AlertDialogDescription>
            Delete "{queueToDelete?.queueName}"?
            <br />
            Queued posts in this queue will be moved to the default queue. This queue&apos;s
            schedule slots will be removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteQueuePending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={deleteQueuePending || !queueToDelete}
            onClick={() => (queueToDelete ? onConfirmDeleteQueue(queueToDelete) : null)}
          >
            {deleteQueuePending ? 'Deleting…' : 'Delete queue'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PublishingScheduleDialogs(props: PublishingScheduleDialogsProps) {
  return (
    <>
      <DeleteQueueDialog
        queueToDelete={props.queueToDelete}
        onQueueToDeleteChange={props.onQueueToDeleteChange}
        deleteQueuePending={props.deleteQueuePending}
        onConfirmDeleteQueue={props.onConfirmDeleteQueue}
      />
      <PostingGoalDialog
        postingGoalOpen={props.postingGoalOpen}
        onPostingGoalOpenChange={props.onPostingGoalOpenChange}
        postingGoalValue={props.postingGoalValue}
        onPostingGoalValueChange={props.onPostingGoalValueChange}
        postingGoalCustomValue={props.postingGoalCustomValue}
        onPostingGoalCustomValueChange={props.onPostingGoalCustomValueChange}
        postingGoalCustomError={props.postingGoalCustomError}
        requiresPostingGoalReplaceConfirm={props.requiresPostingGoalReplaceConfirm}
        selectedQueueSlotCount={props.selectedQueueSlotCount}
        postingGoalConfirmReplace={props.postingGoalConfirmReplace}
        onPostingGoalConfirmReplaceChange={props.onPostingGoalConfirmReplaceChange}
        applyPostingGoalPending={props.applyPostingGoalPending}
        canApplyPostingGoal={props.canApplyPostingGoal}
        onApplyPostingGoal={props.onApplyPostingGoal}
      />
    </>
  );
}
