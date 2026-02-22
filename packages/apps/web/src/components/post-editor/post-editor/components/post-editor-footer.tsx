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
import AssetPicker from '@/features/assets/components/AssetPicker';
import type { AssetReference } from '@/components/multi-image-uploader/types';
import { QueueSlotPickerDialog } from '@/components/post-editor/queue-slot-picker-dialog';
import { WriteItBar } from '@/components/post-editor/write-it-bar';
import { PostPublicationFooter } from '@/components/post-editor/post-publication-footer';
import { formatScheduledInput, mergeUniqueAssets } from '../utils';
import type { InstagramContentType } from '@postolio/content-validation';

import type { PostEditorState } from '../hooks/use-post-editor';

export function PostEditorFooter({ state }: { state: PostEditorState }) {
  const isCreating = !state.id;

  const showFooter = !(state.template.isTemplateTab && state.data.isMultiDestinationGroup);
  if (!showFooter) {
    return null;
  }

  const post = state.data.post;

  const handleCreateMode = () => {
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
        onOpenPublishingSchedule={() =>
          (window.location.href = '/social-accounts/publishing-schedule')
        }
        onUpgradePlan={() => (window.location.href = '/limits')}
      />
    );
  };

  const handleDisabledPublished = () => {
    if (!post) {
      return null;
    }
    return (
      <PostPublicationFooter
        layout={state.layout}
        publishedAt={post.postedAt}
        brandTimezone={state.brandTimezone}
        preview={state.preview.publicationPreview}
        links={state.preview.publicationLinks}
      />
    );
  };

  const handleEditMode = () => {
    if (state.data.isPostLoading || !post) {
      return null;
    }
    if (state.derived.disabled) {
      return handleDisabledPublished();
    }

    return (
      <WriteItBar
        mode="edit"
        layout={state.layout}
        leadingActions={
          state.layout === 'sidebar' && state.id && !state.data.isMultiDestinationGroup ? (
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
                        state.mutations.isDeleting ||
                        state.mutations.isUnscheduling ||
                        !post?.scheduledAt
                      }
                      onClick={() => {
                        if (!state.id) {
                          return;
                        }
                        if (!post?.scheduledAt) {
                          return;
                        }
                        state.mutations.unschedulePost(state.id);
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
          ) : null
        }
        scheduledAt={state.form.formData.scheduledAt}
        minScheduleInput={state.derived.minScheduleInput}
        brandTimezone={state.brandTimezone}
        isScheduled={state.derived.isScheduled}
        hasChanges={state.form.hasChanges}
        isSaving={
          state.data.isMultiDestinationGroup
            ? state.mutations.isSaving || state.mutations.isSchedulingContentGroup
            : state.mutations.isSaving
        }
        isUnscheduling={
          state.data.isMultiDestinationGroup
            ? state.mutations.isSchedulingContentGroup
            : state.mutations.isUnscheduling
        }
        validationOk={state.derived.validation.ok}
        primaryEditCtaLabel={state.preview.primaryEditCtaLabel}
        onScheduledAtChange={(value) =>
          state.form.setFormData((s) => ({ ...s, scheduledAt: value }))
        }
        onUnschedule={() => {
          if (state.data.isMultiDestinationGroup) {
            void state.mutations.scheduleContentGroup(null);
            return;
          }
          if (state.id) {
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
        onOpenPublishingSchedule={() =>
          (window.location.href = '/social-accounts/publishing-schedule')
        }
      />
    );
  };

  const footer = isCreating ? handleCreateMode() : handleEditMode();

  return (
    <>
      {footer}

      <QueueSlotPickerDialog
        open={state.ui.slotPickerOpen}
        onOpenChange={state.ui.setSlotPickerOpen}
        socialAccountId={
          state.destinations.selectedPlatformAccountIds.length === 1
            ? state.destinations.selectedPlatformAccountIds[0]!
            : null
        }
        laneKey={
          state.form.formData.contentType === 'reel' || state.form.formData.contentType === 'story'
            ? state.form.formData.contentType
            : 'post'
        }
        brandTimezone={state.brandTimezone}
        onPick={(scheduledAtIso) =>
          state.form.handleScheduledAtChange(
            formatScheduledInput(scheduledAtIso, state.brandTimezone)
          )
        }
      />

      {state.ui.showAssetPicker && state.data.brandIdForAssets ? (
        <AssetPicker
          brandId={state.data.brandIdForAssets}
          type={
            state.ui.assetPickerTarget === 'template'
              ? state.template.templateFormData.contentType === 'reel'
                ? 'video'
                : undefined
              : state.form.formData.contentType === 'reel'
                ? 'video'
                : undefined
          }
          onSelectMany={(assets) => {
            const normalized: AssetReference[] = assets.map((asset) => ({
              id: asset.id,
              url: asset.url,
              type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
            }));

            const applyAssetSelection = (
              current: { contentType: InstagramContentType; carouselAssets: AssetReference[] },
              options?: { disallowMixed?: boolean }
            ) => {
              const allowMixing = current.contentType === 'post' && options?.disallowMixed !== true;
              if (!allowMixing) {
                const firstVideo = normalized.find((asset) => asset.type === 'video') || null;
                const imageAssets = normalized.filter((asset) => asset.type !== 'video');
                return firstVideo ? [firstVideo] : imageAssets.slice(0, 10);
              }
              return mergeUniqueAssets([...current.carouselAssets, ...normalized], 10);
            };

            if (state.ui.assetPickerTarget === 'template') {
              state.template.setTemplateFormData((s) => ({
                ...s,
                carouselAssets: applyAssetSelection(s, {
                  disallowMixed: state.data.groupPlatforms.includes('facebook'),
                }),
              }));
            } else {
              state.form.setFormData((s) => ({
                ...s,
                carouselAssets: applyAssetSelection(s, {
                  disallowMixed: state.destinations.selectedPlatforms.includes('facebook'),
                }),
              }));
            }
            state.ui.setShowAssetPicker(false);
          }}
          onClose={() => state.ui.setShowAssetPicker(false)}
        />
      ) : null}
    </>
  );
}
