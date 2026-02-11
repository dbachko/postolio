import { LayoutTemplate } from 'lucide-react';

import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { DestinationsRail, DestinationsRailItem } from '@/components/post-editor/destinations-rail';
import { PostEditorMainBody } from '@/components/post-editor/post-editor-main-body';
import { ContentGroupTemplateEditor } from '@/components/post-editor/content-group-template-editor';

import type { PostEditorState } from '../../hooks/use-post-editor';
import { DestinationsRailFooter } from './components/destinations-rail-footer';
import { GroupHeaderBar } from './components/group-header-bar';
import { EditDestinationsHelpDialog } from './components/edit-destinations-help-dialog';

export function PostEditorMultiDestinationLayout({
  state,
  previewPanel,
  inlinePreviewPanel,
}: {
  state: PostEditorState;
  previewPanel: React.ReactNode;
  inlinePreviewPanel: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <DestinationsRail
        title="Multi-destination group"
        footer={<DestinationsRailFooter state={state} />}
      >
        <DestinationsRailItem
          tooltip="Edit the base template for all destinations"
          ariaLabel="Edit template"
          selected={state.template.isTemplateTab}
          disabled={state.mutations.isSaving}
          onClick={() => void state.destinationActions.handleGroupTabChange('template')}
        >
          <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
        </DestinationsRailItem>

        {state.data.groupDestinations.map((dest) => {
          const selected = dest.contentId === state.id && !state.template.isTemplateTab;
          const tooltipLabel = dest.disconnected ? `${dest.label} (disconnected)` : dest.label;
          return (
            <DestinationsRailItem
              key={dest.contentId}
              tooltip={tooltipLabel}
              ariaLabel={`Switch to ${tooltipLabel}`}
              selected={selected}
              disabled={state.mutations.isSaving || dest.disconnected}
              onClick={() => void state.destinationActions.handleGroupTabChange(dest.contentId)}
            >
              <SocialAccountAvatar
                platform={dest.platform}
                name={dest.avatarName}
                src={dest.avatarUrl}
                size="sm"
                selected={selected}
                disabled={dest.disconnected}
              />
            </DestinationsRailItem>
          );
        })}
      </DestinationsRail>

      <div className={state.derived.groupBodyClass}>
        {state.preview.showPreviewAsBody ? (
          previewPanel
        ) : (
          <>
            <GroupHeaderBar state={state} />

            {inlinePreviewPanel}

            {state.template.isTemplateTab ? (
              state.data.contentGroupQuery.isLoading || !state.data.contentGroupTemplate ? (
                <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                  Loading template...
                </div>
              ) : !state.data.brandIdForAssets ? (
                <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                  Template editor unavailable: missing brand context.
                </div>
              ) : (
                <ContentGroupTemplateEditor
                  brandId={state.data.brandIdForAssets}
                  platforms={state.data.groupPlatforms}
                  value={state.template.templateFormData}
                  onChange={(updater) =>
                    state.template.setTemplateFormData((prev) => updater(prev))
                  }
                  firstCommentOpen={state.template.templateFirstCommentOpen}
                  onFirstCommentOpenChange={state.template.setTemplateFirstCommentOpen}
                  onOpenAssetPicker={() => {
                    state.ui.setAssetPickerTarget('template');
                    state.ui.setShowAssetPicker(true);
                  }}
                />
              )
            ) : (
              <PostEditorMainBody
                mode="edit"
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
            )}
          </>
        )}
      </div>

      {state.preview.showPreviewInColumn ? previewPanel : null}

      <EditDestinationsHelpDialog state={state} />
    </div>
  );
}
