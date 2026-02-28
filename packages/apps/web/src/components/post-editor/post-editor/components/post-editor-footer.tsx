import { Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import { QueueSlotPickerDialog } from '@/components/post-editor/queue-slot-picker-dialog';
import { PostPublicationFooter } from '@/components/post-editor/post-publication-footer';
import { WriteItBar } from '@/components/post-editor/write-it-bar';

import type { PostEditorState } from '../hooks/use-post-editor';
import { formatScheduledInput } from '../utils';

import { FooterAssetPicker } from './post-editor-footer-asset-picker';

function openPublishingSchedule(): void {
  window.location.href = '/social-accounts/publishing-schedule';
}

function DeletePostAction({
  state,
  post,
}: {
  state: PostEditorState;
  post: NonNullable<PostEditorState['data']['post']>;
}) {
  if (state.layout !== 'sidebar' || !state.id || state.data.isMultiDestinationGroup) {
    return null;
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Delete"
          disabled={state.mutations.isDeleting}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogCancel asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close"
            disabled={state.mutations.isDeleting || state.mutations.isUnscheduling}
            className="absolute top-4 right-4"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </AlertDialogCancel>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure you want to delete it?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={state.mutations.isDeleting || state.mutations.isUnscheduling}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              type="button"
              variant="ghost"
              disabled={
                state.mutations.isDeleting || state.mutations.isUnscheduling || !post.scheduledAt
              }
              onClick={() => {
                if (state.id && post.scheduledAt) {
                  state.mutations.unschedulePost(state.id);
                }
              }}
            >
              Move to Draft
            </Button>
          </AlertDialogAction>
          <AlertDialogAction asChild>
            <Button
              type="button"
              variant="destructive"
              disabled={state.mutations.isDeleting}
              onClick={() => void state.mutations.deletePostAsync()}
            >
              Delete
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CreateModeFooterBar({ state }: { state: PostEditorState }) {
  if (!state.selectedBrand) {
    return null;
  }
  return (
    <WriteItBar
      mode="create"
      layout={state.layout}
      scheduledAt={state.form.formData.scheduledAt}
      minScheduleInput={state.derived.minScheduleInput}
      brandTimezone={state.brandTimezone}
      atCapacity={state.data.atCapacity}
      scheduleBlocker={state.derived.scheduleBlocker}
      createScheduleDisabled={
        state.createPostMutation.isCreatingPost || Boolean(state.derived.scheduleBlocker)
      }
      isCreatingPost={state.createPostMutation.isCreatingPost}
      saveDraftDisabled={state.derived.saveDraftDisabled}
      saveDraftBlocker={state.derived.saveDraftBlocker}
      publishNowDisabled={state.derived.publishNowDisabled}
      publishNowBlocker={state.derived.publishNowBlocker}
      onScheduledAtChange={state.form.handleScheduledAtChange}
      onSchedule={() => state.createPostMutation.createPost('schedule')}
      onSaveDraft={() => state.createPostMutation.createPost('draft')}
      onAddToQueue={() => state.createPostMutation.createPost('queue')}
      onPublishNow={() => state.createPostMutation.createPost('now')}
      queueOptionDisabled={state.derived.queueOptionDisabled}
      queueOptionBlocker={state.derived.queueOptionBlocker}
      queueDisabled={state.derived.queueDisabled}
      queueBlocker={state.derived.queueBlocker}
      queueNeedsPublishingSchedule={state.derived.queueNeedsPublishingSchedule}
      onPickSlot={() => state.ui.setSlotPickerOpen(true)}
      pickSlotDisabled={state.derived.pickSlotDisabled}
      pickSlotBlocker={state.derived.pickSlotBlocker}
      pickSlotNeedsPublishingSchedule={state.derived.pickSlotNeedsPublishingSchedule}
      onOpenPublishingSchedule={openPublishingSchedule}
      onUpgradePlan={() => {
        window.location.href = '/limits';
      }}
    />
  );
}

function PublishedFooter({
  state,
  post,
}: {
  state: PostEditorState;
  post: NonNullable<PostEditorState['data']['post']>;
}) {
  return (
    <PostPublicationFooter
      layout={state.layout}
      publishedAt={post.postedAt}
      brandTimezone={state.brandTimezone}
      preview={state.preview.publicationPreview}
      links={state.preview.publicationLinks}
    />
  );
}

function EditModeFooterBar({
  state,
  post,
}: {
  state: PostEditorState;
  post: NonNullable<PostEditorState['data']['post']>;
}) {
  if (state.data.isPostLoading) {
    return null;
  }
  if (state.derived.disabled) {
    return <PublishedFooter state={state} post={post} />;
  }

  const isSaving = state.data.isMultiDestinationGroup
    ? state.mutations.isSaving || state.mutations.isSchedulingContentGroup
    : state.mutations.isSaving;
  const isUnscheduling = state.data.isMultiDestinationGroup
    ? state.mutations.isSchedulingContentGroup
    : state.mutations.isUnscheduling;

  return (
    <WriteItBar
      mode="edit"
      layout={state.layout}
      leadingActions={<DeletePostAction state={state} post={post} />}
      scheduledAt={state.form.formData.scheduledAt}
      minScheduleInput={state.derived.minScheduleInput}
      brandTimezone={state.brandTimezone}
      isScheduled={state.derived.isScheduled}
      hasChanges={state.form.hasChanges}
      isSaving={isSaving}
      isUnscheduling={isUnscheduling}
      validationOk={state.derived.validation.ok}
      primaryEditCtaLabel={state.preview.primaryEditCtaLabel}
      onScheduledAtChange={(value) =>
        state.form.setFormData((current) => ({ ...current, scheduledAt: value }))
      }
      onUnschedule={() => {
        if (state.data.isMultiDestinationGroup) {
          void state.mutations.scheduleContentGroup(null);
        } else if (state.id) {
          state.mutations.unschedulePost(state.id);
        }
      }}
      onSave={state.saveActions.handleSaveChanges}
      onAddToQueue={() => void state.saveActions.moveToQueue()}
      queueDisabled={!state.derived.queueSupportedForPost}
      queueBlocker={state.derived.queueBlockerForPost}
      queueNeedsPublishingSchedule={state.derived.queueNeedsPublishingScheduleForPost}
      isQueueing={state.mutations.isQueueing}
      onPublishNow={() => void state.mutations.publishNowAsync()}
      publishNowDisabled={state.derived.publishNowDisabled}
      publishNowBlocker={state.derived.publishNowBlocker}
      isPublishingNow={state.mutations.isPublishingNow}
      onPickSlot={() => state.ui.setSlotPickerOpen(true)}
      pickSlotDisabled={state.derived.pickSlotDisabled}
      pickSlotBlocker={state.derived.pickSlotBlocker}
      pickSlotNeedsPublishingSchedule={state.derived.pickSlotNeedsPublishingSchedule}
      onOpenPublishingSchedule={openPublishingSchedule}
    />
  );
}

function FooterWriteBar({ state }: { state: PostEditorState }) {
  const post = state.data.post;
  if (!post && state.id) {
    return null;
  }
  return !state.id ? (
    <CreateModeFooterBar state={state} />
  ) : (
    <EditModeFooterBar state={state} post={post!} />
  );
}

function FooterQueueSlotPicker({ state }: { state: PostEditorState }) {
  const laneKey =
    state.form.formData.contentType === 'reel' || state.form.formData.contentType === 'story'
      ? state.form.formData.contentType
      : 'post';
  const socialAccountId =
    state.destinations.selectedPlatformAccountIds.length === 1
      ? state.destinations.selectedPlatformAccountIds[0]!
      : null;

  return (
    <QueueSlotPickerDialog
      open={state.ui.slotPickerOpen}
      onOpenChange={state.ui.setSlotPickerOpen}
      socialAccountId={socialAccountId}
      laneKey={laneKey}
      brandTimezone={state.brandTimezone}
      onPick={(scheduledAtIso) =>
        state.form.handleScheduledAtChange(
          formatScheduledInput(scheduledAtIso, state.brandTimezone)
        )
      }
    />
  );
}

export function PostEditorFooter({ state }: { state: PostEditorState }) {
  if (state.template.isTemplateTab && state.data.isMultiDestinationGroup) {
    return null;
  }

  return (
    <>
      <FooterWriteBar state={state} />
      <FooterQueueSlotPicker state={state} />
      <FooterAssetPicker state={state} />
    </>
  );
}
