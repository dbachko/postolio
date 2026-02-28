import type { PostEditorState } from '../hooks/use-post-editor';
import {
  PostEditorCreateLayoutMultiDestination,
  PostEditorCreateLayoutSingleDestination,
} from './post-editor-layout-create-parts';

export function PostEditorCreateLayout({
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
      <PostEditorCreateLayoutSingleDestination
        state={state}
        previewPanel={previewPanel}
        inlinePreviewPanel={inlinePreviewPanel}
        previewToggleButton={previewToggleButton}
      />
    );
  }

  return (
    <PostEditorCreateLayoutMultiDestination
      state={state}
      previewPanel={previewPanel}
      inlinePreviewPanel={inlinePreviewPanel}
      previewToggleButton={previewToggleButton}
    />
  );
}
