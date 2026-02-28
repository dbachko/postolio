import type { Platform } from '@/lib/platform-config';
import type { ConversationState } from '@/lib/api/types';

export type InboxChannelFilter = 'all' | 'comments' | 'dms';
export type InboxPlatformFilter = 'all' | Platform;

export type InboxCommentThreadItem = {
  type: 'comment_thread';
  platform: Platform;
  socialAccountId: string;
  publicationId: string;
  postId: string;
  caption: string | null;
  primaryAssetId: string | null;
  permalink: string | null;
  postedAt: string | null;
  totalComments: number;
  resolvedCount: number;
  newCount: number;
  lastActivityAt: string | null;
  previewText: string | null;
  previewAuthorUsername: string | null;
};

export type InboxDMConversationItem = {
  type: 'dm_conversation';
  platform: Platform;
  socialAccountId: string;
  conversationId: string;
  state: ConversationState;
  participantUsername: string;
  lastMessageAt: string;
  lastMessageText: string | null;
  lastMessageDirection: 'inbound' | 'outbound' | null;
  messageCount: number;
};

export type InboxItem = InboxCommentThreadItem | InboxDMConversationItem;

export type CommentItem = {
  id?: string;
  text?: string;
  username?: string;
  timestamp?: string;
};

export type ConnectedAccount = {
  id: string;
  platform: Platform;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  disconnected?: boolean;
  sortOrder?: number;
  createdAt?: string;
};
