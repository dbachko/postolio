import { Link } from 'react-router-dom';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';

import type { PostEditorState } from '../hooks/use-post-editor';

export function PostEditorHeader({ state }: { state: PostEditorState }) {
  const { id, layout, showHeader } = state;
  if (!showHeader) return null;

  return (
    <div className={state.derived.headerClass}>
      <div className="min-w-0">
        {id ? (
          <Breadcrumb aria-label="right-sidebar-title">
            <BreadcrumbList>
              <BreadcrumbItem>
                {state.data.isPostLoading ? (
                  <BreadcrumbPage>Loading…</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={`/posts/${id}`}>
                      {state.derived.disabled ? 'View Post' : 'Edit Post'}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        ) : (
          <Breadcrumb aria-label="right-sidebar-title">
            <BreadcrumbList>
              <BreadcrumbItem>
                {layout === 'sidebar' ? (
                  <BreadcrumbLink asChild>
                    <Link to="/posts/create" onClick={state.handleOpenCreatePage}>
                      Create New Post
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>Create New Post</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        )}
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap">
        {layout === 'sidebar' ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={state.handleCloseSidebar}
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
