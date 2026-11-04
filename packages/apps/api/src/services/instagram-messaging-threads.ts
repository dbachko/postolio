import axios from 'axios';
import { logger as baseLogger } from '@postolio/logger';
import { formatError } from '../utils/logging.js';

const messagingLogger = baseLogger.child({ module: 'instagram-messaging-threads' });
const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
const fbGraph = (path: string) => `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

type BrandData = { id: string };
type ServiceLike = any;

function assertMessageText(text: string): void {
  if (!text?.trim()) {
    throw new Error('Message must not be empty');
  }
}

function isUnsupportedMessageError(message: string): boolean {
  return /Unsupported|not allowed|Unknown path|(#|code)\s?100/i.test(message);
}

async function postDmMessage(params: {
  threadId: string;
  text: string;
  accessToken: string;
}): Promise<{ supported: boolean; success: boolean; message?: string }> {
  try {
    const response = await axios.post(fbGraph(`${params.threadId}/messages`), {
      message: params.text,
      access_token: params.accessToken,
    });
    const ok = Boolean((response.data as any)?.success || (response.data as any)?.id);
    return { supported: true, success: ok };
  } catch (error) {
    const message = (error as any)?.response?.data?.error?.message || (error as Error).message;
    if (isUnsupportedMessageError(message)) {
      return { supported: false, success: false, message };
    }
    messagingLogger.error('Failed to send DM message', formatError(error));
    throw new Error(`Failed to send DM: ${message}`, { cause: error });
  }
}

export async function listDmThreadsImpl(
  service: ServiceLike,
  brand: BrandData | string,
  opts: { limit?: number; after?: string } = {}
): Promise<{
  supported: boolean;
  threads: Array<{ id: string; updated_time?: string; participants?: any[] }>;
  paging?: any;
}> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }

  const limit = opts.limit ?? 25;
  const credentials = await service.getCredentialsOrThrow(brand);
  await service.checkRateLimit(String(credentials.accountId));

  const query = [`limit=${limit}`, `access_token=${credentials.accessToken}`];
  if (opts.after) {
    query.push(`after=${encodeURIComponent(opts.after)}`);
  }

  const paths = [
    `${credentials.accountId}/conversations?${query.join('&')}`,
    `${credentials.pageId}/conversations?platform=instagram&${query.join('&')}`,
  ].filter(Boolean) as string[];

  const response = (await service.tryGraphGet(paths)) as { data: any[]; paging?: any } | null;
  if (!response) {
    return { supported: false, threads: [] };
  }

  const threads = (response.data || []).map((conversation: any) => ({
    id: String(conversation.id || ''),
    updated_time: conversation.updated_time,
    participants: conversation.participants?.data || conversation.participants || [],
  }));
  return { supported: true, threads, paging: response.paging };
}

export async function listDmThreadsForSocialAccountImpl(
  service: ServiceLike,
  socialAccountId: string,
  opts: { limit?: number; after?: string } = {}
): Promise<{
  supported: boolean;
  threads: Array<{ id: string; updated_time?: string; participants?: any[] }>;
  paging?: any;
}> {
  const limit = opts.limit ?? 25;
  const credentials = await service.getCredentialsOrThrowForSocialAccount(socialAccountId);
  await service.checkRateLimit(String(credentials.accountId));

  const query = [`limit=${limit}`, `access_token=${credentials.accessToken}`];
  if (opts.after) {
    query.push(`after=${encodeURIComponent(opts.after)}`);
  }

  const paths = [
    `${credentials.accountId}/conversations?${query.join('&')}`,
    `${credentials.pageId}/conversations?platform=instagram&${query.join('&')}`,
  ].filter(Boolean) as string[];

  const response = (await service.tryGraphGet(paths)) as { data: any[]; paging?: any } | null;
  if (!response) {
    return { supported: false, threads: [] };
  }

  const threads = (response.data || []).map((conversation: any) => ({
    id: String(conversation.id || ''),
    updated_time: conversation.updated_time,
    participants: conversation.participants?.data || conversation.participants || [],
  }));
  return { supported: true, threads, paging: response.paging };
}

export async function getDmThreadMessagesImpl(
  service: ServiceLike,
  brand: BrandData | string,
  threadId: string,
  opts: { limit?: number; before?: string } = {}
): Promise<{
  supported: boolean;
  messages: Array<{ id: string; message?: string; from?: any; created_time?: string }>;
  paging?: any;
}> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }

  const limit = opts.limit ?? 50;
  const credentials = await service.getCredentialsOrThrow(brand);
  await service.checkRateLimit(String(credentials.accountId));

  const query = [
    `limit=${limit}`,
    `access_token=${credentials.accessToken}`,
    'fields=from,to,message,created_time,id',
  ];
  if (opts.before) {
    query.push(`before=${encodeURIComponent(opts.before)}`);
  }

  const response = (await service.tryGraphGet([
    `${threadId}/messages?${query.join('&')}`,
    `${threadId}?fields=messages{from,to,message,created_time,id}&${query
      .filter((entry) => !entry.startsWith('fields='))
      .join('&')}`,
  ])) as { data?: any[]; messages?: { data?: any[] }; paging?: any } | null;
  if (!response) {
    return { supported: false, messages: [] };
  }

  const rows = (response as any).data
    ? (response as any).data
    : (response as any).messages?.data || [];
  const messages = rows.map((message: any) => ({
    id: String(message.id || ''),
    message: message.message,
    from: message.from,
    created_time: message.created_time,
  }));
  return { supported: true, messages, paging: (response as any).paging };
}

export async function getDmThreadMessagesForSocialAccountImpl(
  service: ServiceLike,
  socialAccountId: string,
  threadId: string,
  opts: { limit?: number; before?: string } = {}
): Promise<{
  supported: boolean;
  messages: Array<{ id: string; message?: string; from?: any; created_time?: string }>;
  paging?: any;
}> {
  const limit = opts.limit ?? 50;
  const credentials = await service.getCredentialsOrThrowForSocialAccount(socialAccountId);
  await service.checkRateLimit(String(credentials.accountId));

  const query = [
    `limit=${limit}`,
    `access_token=${credentials.accessToken}`,
    'fields=from,to,message,created_time,id',
  ];
  if (opts.before) {
    query.push(`before=${encodeURIComponent(opts.before)}`);
  }

  const response = (await service.tryGraphGet([
    `${threadId}/messages?${query.join('&')}`,
    `${threadId}?fields=messages{from,to,message,created_time,id}&${query
      .filter((entry) => !entry.startsWith('fields='))
      .join('&')}`,
  ])) as { data?: any[]; messages?: { data?: any[] }; paging?: any } | null;
  if (!response) {
    return { supported: false, messages: [] };
  }

  const rows = (response as any).data
    ? (response as any).data
    : (response as any).messages?.data || [];
  const messages = rows.map((message: any) => ({
    id: String(message.id || ''),
    message: message.message,
    from: message.from,
    created_time: message.created_time,
  }));
  return { supported: true, messages, paging: (response as any).paging };
}

export async function sendDmMessageImpl(
  service: ServiceLike,
  brand: BrandData | string,
  threadId: string,
  text: string
): Promise<{ supported: boolean; success: boolean; errorCode?: string; message?: string }> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }
  assertMessageText(text);

  const credentials = await service.getCredentialsOrThrow(brand);
  await service.checkRateLimit(String(credentials.accountId));
  const recent = await service.getDmThreadMessages(brand, threadId, { limit: 20 });
  if (!recent.supported) {
    return { supported: false, success: false };
  }

  const selfIds = [credentials.accountId, credentials.pageId].filter(Boolean).map(String);
  const inWindow = service.isWithin24hWindow(recent.messages, selfIds as string[]);
  if (!inWindow) {
    return {
      supported: true,
      success: false,
      errorCode: 'WINDOW_CLOSED',
      message: '24-hour messaging window has expired',
    };
  }

  return postDmMessage({
    threadId,
    text,
    accessToken: credentials.accessToken,
  });
}
