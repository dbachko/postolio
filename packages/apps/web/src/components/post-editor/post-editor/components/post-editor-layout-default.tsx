import { PostEditorMainBody } from '@/components/post-editor/post-editor-main-body';

import type { PostEditorState } from '../hooks/use-post-editor';

export function PostEditorDefaultLayout({
  state,
  previewPanel,
  inlinePreviewPanel,
  previewToggleButton,
}: {
  state: PostEditorState;
  previewPanel: React.ReactNode;
  inlinePreviewPanel: React.ReactNode;
  previewToggleButton: React.ReactNode;
}) {
  const isCreating = !state.id;

  return (
    <div className={state.derived.bodyClass}>
      {state.preview.showPreviewAsBody ? (
        previewPanel
      ) : (
        <>
          {inlinePreviewPanel}
          {state.preview.showInlinePreviewToggle ? (
            <div className="flex items-center justify-end pb-2">{previewToggleButton}</div>
          ) : null}
          <PostEditorMainBody
            mode={isCreating ? 'create' : 'edit'}
            allowMixedMedia={state.derived.allowMixedMedia}
            disabled={state.derived.disabled}
            isLoading={state.data.isPostLoading}
            post={state.data.post}
            selectedBrand={state.selectedBrand}
            formData={state.form.formData}
            setFormData={(updater) => state.form.setFormData((prev) => updater(prev))}
            firstCommentOpen={state.form.firstCommentOpen}
            setFirstCommentOpen={state.form.setFirstCommentOpen}
            onOpenAssetPicker={() => {
              state.ui.setAssetPickerTarget('destination');
              state.ui.setShowAssetPicker(true);
            }}
            platformOptions={state.data.platformPickerOptions}
            selectedPlatformAccountIds={state.destinations.selectedPlatformAccountIds}
            onSelectedPlatformAccountIdsChange={state.destinations.handlePlatformAccountsChange}
          />
        </>
      )}
    </div>
  );
}
