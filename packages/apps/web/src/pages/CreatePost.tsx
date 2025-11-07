import { useBrandStore } from '@/stores/brandStore';
import { PostSidebar } from '@/right-sidebar/PostSidebar';
import { AppEmptyState } from '@/components/AppEmptyState';

export function CreatePost() {
  const { selectedBrand } = useBrandStore();

  if (!selectedBrand) {
    return (
      <div className="px-6 py-10">
        <AppEmptyState
          title="Choose a brand to create a post"
          description="Post drafts, approvals, and analytics are tied to a single brand."
          actions={[{ label: 'Select Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  return (
    <div className="px-6 py-8">
      <h1 className="mb-6 text-3xl font-semibold">Create New Post</h1>
      <PostSidebar layout="page" showHeader={false} />
    </div>
  );
}
