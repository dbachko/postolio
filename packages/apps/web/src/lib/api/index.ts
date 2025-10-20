import { createHttp, createHttpMethods } from '@/lib/http/http';
import { AuthClient, SessionClient } from './auth-client';
import { BrandClient } from './brand-client';
import { CampaignClient } from './campaign-client';
import { ContentClient } from './content-client';

const http = createHttp();
const { get: httpGet, post: httpPost, put: httpPut, del: httpDelete } = createHttpMethods(http);

export const auth = new AuthClient(http);
export const session = new SessionClient(http);
export const brand = new BrandClient(http);
export const campaign = new CampaignClient(http);
export const content = new ContentClient(http);

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
} from './types';
