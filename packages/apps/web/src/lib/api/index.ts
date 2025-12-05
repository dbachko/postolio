import { createHttp, createHttpMethods } from '@/lib/http/http';
import { AuthClient, SessionClient } from './auth-client';
import { BrandClient } from './brand-client';
import { CampaignClient } from './campaign-client';
import { ContentClient } from './content-client';
import { NotificationsClient } from './notifications-client';
import { AnalyticsV2Client } from './analytics-v2-client';
import { OnboardingClient } from './onboarding-client';

const http = createHttp();
const { get: httpGet, post: httpPost, put: httpPut, del: httpDelete } = createHttpMethods(http);

export const auth = new AuthClient(http);
export const session = new SessionClient(http);
export const brand = new BrandClient(http);
export const campaign = new CampaignClient(http);
export const content = new ContentClient(http);
export const notifications = new NotificationsClient(http);
export const onboarding = new OnboardingClient(http);
export const analyticsV2 = new AnalyticsV2Client(http);

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
} from './types';
