import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { PostEditor } from '@/components/post-editor/PostEditor';

type PostSidebarLayout = 'sidebar' | 'page';

interface PostSidebarProps {
  id?: string;
  layout?: PostSidebarLayout;
  showHeader?: boolean;
}

export function PostSidebar({ id, layout = 'sidebar', showHeader = true }: PostSidebarProps) {
  const { close } = useRightSidebarRouter();
  return <PostEditor id={id} layout={layout} showHeader={showHeader} onRequestClose={close} />;
}
