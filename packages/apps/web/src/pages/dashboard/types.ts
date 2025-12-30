export type CommentsInboxItem = {
  postId: string;
  caption: string | null;
  permalink: string | null;
  postedAt: string | null;
  totalComments: number;
  resolvedCount: number;
  newCount: number;
};
