import type { Platform } from '@/lib/platform-config';

// ============================================
// DM Automation Types
// ============================================

export type DMTriggerType = 'comment_keyword' | 'dm_keyword' | 'comment_any' | 'dm_any';
export type DMActionType = 'send_dm' | 'reply_comment' | 'send_dm_and_reply';
export type DMRuleStatus = 'active' | 'paused' | 'archived';

export interface DMTriggerConfig {
  keywords: string[];
  matchType: 'exact' | 'contains' | 'regex';
}

export interface DMActiveHours {
  start: string; // HH:MM format
  end: string; // HH:MM format
  timezone?: string;
}

export interface DMAutomationRule {
  id: string;
  brandId: string;
  name: string;
  triggerType: DMTriggerType;
  triggerConfig: DMTriggerConfig;
  actionType: DMActionType;
  messageTemplate: string;
  commentReplyTemplate: string | null;
  status: DMRuleStatus;
  priority: number;
  maxUsesPerUser: number | null;
  cooldownMinutes: number | null;
  activeHours: DMActiveHours | null;
  activeDays: number[] | null; // 0=Sunday, 6=Saturday
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface CreateRuleInput {
  name: string;
  triggerType: DMTriggerType;
  triggerConfig: DMTriggerConfig;
  actionType: DMActionType;
  messageTemplate: string;
  commentReplyTemplate?: string;
  maxUsesPerUser?: number;
  cooldownMinutes?: number;
  activeHours?: DMActiveHours;
  activeDays?: number[];
  priority?: number;
}

export interface UpdateRuleInput extends Partial<CreateRuleInput> {
  status?: DMRuleStatus;
}

export interface DMAutomationAnalytics {
  period: {
    days: number;
    since: string;
  };
  overview: {
    totalEvents: number;
    messagesSent: number;
    commentRepliesSent: number;
    rateLimitedEvents: number;
    uniqueUsers: number;
    successRate: number;
  };
  byRule: Array<{
    ruleId: string;
    ruleName: string;
    totalEvents: number;
    messagesSent: number;
    commentRepliesSent: number;
    rateLimited: number;
  }>;
}

export type ConversationState = 'active' | 'archived' | 'spam';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'pending' | 'sent' | 'failed' | 'delivered' | 'read';

export interface DMConversation {
  id: string;
  brandId: string;
  socialAccountId: string;
  ruleId: string | null;
  platform: Platform;
  participantExternalUserId: string;
  participantUsername: string;
  state: ConversationState;
  currentStep: number;
  contextData: unknown | null;
  startedAt: string;
  lastMessageAt: string;
  completedAt: string | null;
  rule?: {
    id: string;
    name: string;
  } | null;
  messageCount?: number;
  lastMessage?: {
    text: string;
    direction: MessageDirection;
    createdAt: string;
  } | null;
}

export interface DMMessage {
  id: string;
  conversationId: string;
  platform: Platform;
  direction: MessageDirection;
  messageText: string;
  externalMessageId: string | null;
  externalCommentId: string | null;
  status: MessageStatus;
  errorMessage: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface SavedReply {
  id: string;
  brandId: string;
  userId: string;
  title: string;
  body: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSavedReplyInput {
  title: string;
  body: string;
  isDefault?: boolean;
}

export interface UpdateSavedReplyInput {
  title?: string;
  body?: string;
  isDefault?: boolean;
}

export interface Snippet {
  id: string;
  brandId: string;
  userId: string;
  title: string;
  content: string;
  tags: string[];
  category: string | null;
  usageCount: number;
  lastUsedAt: Date | null;
  isFavorite: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSnippetInput {
  title: string;
  content: string;
  tags?: string[];
  category?: string;
  isFavorite?: boolean;
}

export interface UpdateSnippetInput {
  title?: string;
  content?: string;
  tags?: string[];
  category?: string;
  isFavorite?: boolean;
  isArchived?: boolean;
}

export interface SnippetsListResponse {
  snippets: Snippet[];
  total: number;
  limit: number;
  offset: number;
}
