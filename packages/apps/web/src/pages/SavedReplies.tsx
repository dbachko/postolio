import { SavedRepliesEmptyBrandView, SavedRepliesView } from './saved-replies/saved-replies-view';
import { useSavedRepliesPage } from './saved-replies/use-saved-replies-page';

export default function SavedReplies() {
  const page = useSavedRepliesPage();

  if (!page.selectedBrand) {
    return <SavedRepliesEmptyBrandView />;
  }

  return (
    <SavedRepliesView
      replies={page.replies}
      isLoading={page.isLoading}
      dialogOpen={page.dialogOpen}
      editingReply={page.editingReply}
      deleteDialogOpen={page.deleteDialogOpen}
      replyToDelete={page.replyToDelete}
      isSaving={page.isSaving}
      onCreate={page.handleCreate}
      onEdit={page.handleEdit}
      onDelete={page.handleDelete}
      onDialogOpenChange={page.setDialogOpen}
      onDeleteDialogOpenChange={page.setDeleteDialogOpen}
      onClearEditingReply={() => page.setEditingReply(null)}
      onSave={page.handleSave}
      onConfirmDelete={page.confirmDelete}
    />
  );
}
