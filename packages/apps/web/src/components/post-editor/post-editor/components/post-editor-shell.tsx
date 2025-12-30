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

      {state.data.isMultiDestinationGroup ? (
        <PostEditorMultiDestinationLayout
          state={state}
          previewPanel={previewPanel}
          inlinePreviewPanel={inlinePreviewPanel}
        />
      ) : isCreating ? (
        <PostEditorCreateLayout
          state={state}
          previewPanel={previewPanel}
          inlinePreviewPanel={inlinePreviewPanel}
          previewToggleButton={previewToggleButton}
        />
      ) : state.layout === 'sidebar' && state.id ? (
        <PostEditorSingleSidebarLayout
          state={state}
          previewPanel={previewPanel}
          inlinePreviewPanel={inlinePreviewPanel}
          previewToggleButton={previewToggleButton}
        />
      ) : (
        <PostEditorDefaultLayout
          state={state}
          previewPanel={previewPanel}
          inlinePreviewPanel={inlinePreviewPanel}
          previewToggleButton={previewToggleButton}
        />
      )}

      <PostEditorFooter state={state} />
    </div>
  );
}
