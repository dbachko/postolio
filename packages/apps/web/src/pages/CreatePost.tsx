import { Alert, AlertDescription } from '@/components/ui/alert';
import { useBrandStore } from '@/stores/brandStore';
import { PostSidebar } from '@/right-sidebar/PostSidebar';

export function CreatePost() {
  const { selectedBrand } = useBrandStore();

  if (!selectedBrand) {
    return (
      <div className="px-6 py-10">
        <Alert>
          <AlertDescription>Select a brand before creating a post.</AlertDescription>
        </Alert>
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
