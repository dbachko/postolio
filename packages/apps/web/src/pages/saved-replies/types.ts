import type { SavedReply } from '@/lib/api';

export interface SavedReplyPayload {
  title: string;
  body: string;
  isDefault: boolean;
}

export interface SavedRepliesDialogState {
  dialogOpen: boolean;
  editingReply: SavedReply | null;
  deleteDialogOpen: boolean;
  replyToDelete: SavedReply | null;
}
