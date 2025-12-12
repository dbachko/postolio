import { useBrandStore } from '@/stores/brandStore';
import { PostSidebar } from '@/right-sidebar/PostSidebar';
import { AppEmptyState } from '@/components/AppEmptyState';

export function CreatePost() {
  const { selectedBrand } = useBrandStore();

  if (!selectedBrand) {
    return (
      <div className="px-6 py-10">
        <AppEmptyState
          variant="minimal"
          title="Choose a brand to create a post"
          description="Post drafts, approvals, and analytics are tied to a single brand."
          actions={[{ label: 'Select Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  return (
    <div>
      <PostSidebar layout="page" showHeader={false} />
    </div>
  );
}
