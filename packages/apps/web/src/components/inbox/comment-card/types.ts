export type CommentRow = {
  id?: string;
  text?: string;
  username?: string;
  timestamp?: string;
  workflow?: { status?: string | null } | null;
};
