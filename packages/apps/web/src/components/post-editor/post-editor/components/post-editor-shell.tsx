import type { ReactNode } from 'react';
import { Eye } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PostPreviewPanel } from '@/components/post-preview/post-preview-panel';

import type { PostEditorState } from '../hooks/use-post-editor';
import { PostEditorHeader } from './post-editor-header';
import { PostEditorMultiDestinationLayout } from './post-editor-layout-multi-destination';
import { PostEditorCreateLayout } from './post-editor-layout-create';
import { PostEditorSingleSidebarLayout } from './post-editor-layout-single-sidebar';
import { PostEditorDefaultLayout } from './post-editor-layout-default';
import { PostEditorFooter } from './post-editor-footer';

function renderPostEditorLayout(params: {
  state: PostEditorState;
  isCreating: boolean;
  previewPanel: ReactNode;
  inlinePreviewPanel: ReactNode;
  previewToggleButton: ReactNode;
}) {
  const { state, isCreating, previewPanel, inlinePreviewPanel, previewToggleButton } = params;
  if (state.data.isMultiDestinationGroup) {
    return (
      <PostEditorMultiDestinationLayout
        state={state}
        previewPanel={previewPanel}
        inlinePreviewPanel={inlinePreviewPanel}
      />
    );
  }
  if (isCreating) {
    return (
      <PostEditorCreateLayout
        state={state}
        previewPanel={previewPanel}
        inlinePreviewPanel={inlinePreviewPanel}
        previewToggleButton={previewToggleButton}
      />
    );
  }
  if (state.layout === 'sidebar' && state.id) {
    return (
      <PostEditorSingleSidebarLayout
        state={state}
        previewPanel={previewPanel}
        inlinePreviewPanel={inlinePreviewPanel}
        previewToggleButton={previewToggleButton}
      />
    );
  }
  return (
    <PostEditorDefaultLayout
      state={state}
      previewPanel={previewPanel}
      inlinePreviewPanel={inlinePreviewPanel}
      previewToggleButton={previewToggleButton}
    />
  );
}

export function PostEditorShell({ state }: { state: PostEditorState }) {
  const isCreating = !state.id;

  const previewPanel = state.ui.previewOpen ? (
    <PostPreviewPanel
      layout={state.preview.previewPanelLayout}
      open={state.ui.previewOpen}
      onOpenChange={state.ui.setPreviewOpen}
      items={state.preview.previewItems}
      unstyled={state.preview.showPreviewAsBody}
    />
  ) : null;

  const inlinePreviewPanel = state.preview.showPreviewInline ? (
    <div className="pb-3">{previewPanel}</div>
  ) : null;

  const previewToggleButton = !state.ui.previewOpen ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => state.ui.setPreviewOpen((open) => !open)}
      className="shrink-0"
    >
      <Eye className="h-4 w-4" />
      <span className="hidden sm:inline">Preview</span>
      <span className="sr-only sm:hidden">Show preview</span>
    </Button>
  ) : null;

  return (
    <div
      className={state.derived.containerClass}
      role="complementary"
      aria-labelledby="right-sidebar-title"
    >
      <PostEditorHeader state={state} />

      {renderPostEditorLayout({
        state,
        isCreating,
        previewPanel,
        inlinePreviewPanel,
        previewToggleButton,
      })}

      <PostEditorFooter state={state} />
    </div>
  );
}
