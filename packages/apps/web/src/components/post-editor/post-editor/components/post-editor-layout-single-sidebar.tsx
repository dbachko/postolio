import type { PostEditorState } from '../hooks/use-post-editor';
import {
  PostEditorSingleSidebarLayoutMultiDestination,
  PostEditorSingleSidebarLayoutSingleDestination,
} from './post-editor-layout-single-sidebar-parts';

export function PostEditorSingleSidebarLayout({
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
  if (!state.flags.multiDestinationEnabled) {
    return (
      <PostEditorSingleSidebarLayoutSingleDestination
        state={state}
        previewPanel={previewPanel}
        inlinePreviewPanel={inlinePreviewPanel}
        previewToggleButton={previewToggleButton}
      />
    );
  }

  return (
    <PostEditorSingleSidebarLayoutMultiDestination
      state={state}
      previewPanel={previewPanel}
      inlinePreviewPanel={inlinePreviewPanel}
      previewToggleButton={previewToggleButton}
    />
  );
}
