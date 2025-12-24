import { createHttp, createHttpMethods } from '@/lib/http/http';
import { AuthClient, SessionClient } from './auth-client';
import { BrandClient } from './brand-client';
import { CampaignClient } from './campaign-client';
import { ContentClient } from './content-client';
import { NotificationsClient } from './notifications-client';
import { AnalyticsClient } from './analytics-client';
import { OnboardingClient } from './onboarding-client';
import { DMAutomationClient } from './dm-automation-client';
import { SavedRepliesClient } from './saved-replies-client';
import { SnippetsClient } from './snippets-client';
import { PublishingQueuesClient } from './publishing-queues-client';

const http = createHttp();
const { get: httpGet, post: httpPost, put: httpPut, del: httpDelete } = createHttpMethods(http);

export const auth = new AuthClient(http);
export const session = new SessionClient(http);
export const brand = new BrandClient(http);
export const campaign = new CampaignClient(http);
export const content = new ContentClient(http);
export const notifications = new NotificationsClient(http);
export const onboarding = new OnboardingClient(http);
export const analytics = new AnalyticsClient(http);
export const dmAutomation = new DMAutomationClient(http);
export const savedReplies = new SavedRepliesClient(http);
export const snippets = new SnippetsClient(http);
export const publishingQueues = new PublishingQueuesClient(http);

export { http, httpGet, httpPost, httpPut, httpDelete };

export type {
  User,
  Brand,
  Content,
  AuthResponse,
  Session,
  SessionsResponse,
  SecuritySummary,
  LoginHistoryItem,
  LoginHistoryResponse,
  CampaignConfig,
  CampaignPreview,
  Campaign,
  Notification,
  NotificationPreference,
  DMAutomationRule,
  CreateRuleInput,
  UpdateRuleInput,
  DMAutomationAnalytics,
  DMTriggerType,
  DMActionType,
  DMRuleStatus,
  DMTriggerConfig,
  DMActiveHours,
  DMConversation,
  DMMessage,
  ConversationState,
  MessageDirection,
  MessageStatus,
  SavedReply,
  CreateSavedReplyInput,
  UpdateSavedReplyInput,
  Snippet,
  CreateSnippetInput,
  UpdateSnippetInput,
  SnippetsListResponse,
} from './types';

export type { SnippetQueryParams } from './snippets-client';
