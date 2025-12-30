import type { PostEditorProps } from './types';
import { PostEditorShell } from './components/post-editor-shell';
import { usePostEditor } from './hooks/use-post-editor';

export function PostEditor(props: PostEditorProps) {
  const state = usePostEditor(props);
  return <PostEditorShell state={state} />;
}
