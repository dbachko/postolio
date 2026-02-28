import axios from 'axios';
import { logger as baseLogger } from '@postolio/logger';
import { formatError } from '../utils/logging.js';

const actionsLogger = baseLogger.child({ module: 'instagram-messaging-actions' });
const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
const fbGraph = (path: string) => `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

type BrandData = { id: string };
type ServiceLike = any;

function assertDirectMessageInputs(recipientId: string, message: string): void {
  if (!message?.trim()) {
    throw new Error('Message must not be empty');
  }
  if (!recipientId) {
    throw new Error('Recipient ID is required');
  }
}

function resolveDirectMessageId(responseData: unknown): string {
  const messageId = String((responseData as any)?.message_id || (responseData as any)?.id || '');
  if (!messageId) {
    throw new Error('Instagram did not return a message ID');
  }
  return messageId;
}

function throwDirectMessageError(error: unknown): never {
  const errorMsg = (error as any)?.response?.data?.error?.message || (error as Error).message;
  if (/24.hour|messaging.window|Cannot message/i.test(errorMsg)) {
    throw new Error('Cannot send message: 24-hour messaging window has expired');
  }
  if (/rate.limit|too.many/i.test(errorMsg)) {
    throw new Error('Rate limit exceeded. Please try again later.');
  }
  actionsLogger.error('Failed to send direct message', formatError(error));
  throw new Error(`Failed to send direct message: ${errorMsg}`);
}

async function sendDirectMessageRequest(params: {
  recipientId: string;
  message: string;
  accessToken: string;
}): Promise<{ messageId: string }> {
  try {
    const response = await axios.post(fbGraph('me/messages'), {
      recipient: { id: params.recipientId },
      message: { text: params.message },
      access_token: params.accessToken,
    });
    return { messageId: resolveDirectMessageId(response.data) };
  } catch (error) {
    return throwDirectMessageError(error);
  }
}

export async function sendDirectMessageImpl(
  service: ServiceLike,
  brand: BrandData | string,
  recipientId: string,
  message: string
): Promise<{ messageId: string }> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }
  assertDirectMessageInputs(recipientId, message);
  const credentials = await service.getCredentialsOrThrow(brand);
  await service.checkRateLimit(String(credentials.accountId));
  return sendDirectMessageRequest({
    recipientId,
    message,
    accessToken: credentials.accessToken,
  });
}

export async function sendDirectMessageForSocialAccountImpl(
  service: ServiceLike,
  socialAccountId: string,
  recipientId: string,
  message: string
): Promise<{ messageId: string }> {
  assertDirectMessageInputs(recipientId, message);
  const credentials = await service.getCredentialsOrThrowForSocialAccount(socialAccountId);
  await service.checkRateLimit(String(credentials.accountId));
  return sendDirectMessageRequest({
    recipientId,
    message,
    accessToken: credentials.accessToken,
  });
}

export async function replyToCommentDirectImpl(
  service: ServiceLike,
  brand: BrandData | string,
  commentId: string,
  message: string
): Promise<{ commentId: string }> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }
  if (!message?.trim()) {
    throw new Error('Reply message must not be empty');
  }
  if (!commentId) {
    throw new Error('Comment ID is required');
  }

  try {
    const credentials = await service.getCredentialsOrThrow(brand);
    await service.checkRateLimit(String(credentials.accountId));
    const response = await axios.post(fbGraph(`${commentId}/replies`), {
      message,
      access_token: credentials.accessToken,
    });
    const replyId = String((response.data as any)?.id || '');
    if (!replyId) {
      throw new Error('Instagram did not return a comment ID');
    }
    return { commentId: replyId };
  } catch (error) {
    const errorMsg = (error as any)?.response?.data?.error?.message || (error as Error).message;
    actionsLogger.error('Failed to reply to comment', formatError(error));
    throw new Error(`Failed to reply to comment: ${errorMsg}`);
  }
}

export async function replyToCommentDirectForSocialAccountImpl(
  service: ServiceLike,
  socialAccountId: string,
  commentId: string,
  message: string
): Promise<{ commentId: string }> {
  if (!message?.trim()) {
    throw new Error('Reply message must not be empty');
  }
  if (!commentId) {
    throw new Error('Comment ID is required');
  }

  try {
    const credentials = await service.getCredentialsOrThrowForSocialAccount(socialAccountId);
    await service.checkRateLimit(String(credentials.accountId));
    const response = await axios.post(fbGraph(`${commentId}/replies`), {
      message,
      access_token: credentials.accessToken,
    });
    const replyId = String((response.data as any)?.id || '');
    if (!replyId) {
      throw new Error('Instagram did not return a comment ID');
    }
    return { commentId: replyId };
  } catch (error) {
    const errorMsg = (error as any)?.response?.data?.error?.message || (error as Error).message;
    actionsLogger.error('Failed to reply to comment', formatError(error));
    throw new Error(`Failed to reply to comment: ${errorMsg}`);
  }
}

export async function replyToCommentImpl(
  service: ServiceLike,
  brand: BrandData | string,
  mediaId: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }
  if (!message?.trim()) {
    throw new Error('Reply message must not be empty');
  }

  try {
    const credentials = await service.getCredentialsOrThrow(brand);
    await service.checkRateLimit(String(credentials.accountId));
    const response = await axios.post(fbGraph(`${mediaId}/comments`), {
      message,
      reply_to_comment_id: commentId,
      access_token: credentials.accessToken,
    } as const);
    const id = String((response.data as any)?.id || '');
    if (!id) {
      throw new Error('Instagram did not return a comment id');
    }
    return { id };
  } catch (error) {
    actionsLogger.error('Failed to reply to comment', formatError(error));
    throw new Error(
      `Failed to reply to comment: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export async function replyToCommentForSocialAccountImpl(
  service: ServiceLike,
  socialAccountId: string,
  mediaId: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  if (!message?.trim()) {
    throw new Error('Reply message must not be empty');
  }

  try {
    const credentials = await service.getCredentialsOrThrowForSocialAccount(socialAccountId);
    await service.checkRateLimit(String(credentials.accountId));
    const response = await axios.post(fbGraph(`${mediaId}/comments`), {
      message,
      reply_to_comment_id: commentId,
      access_token: credentials.accessToken,
    } as const);
    const id = String((response.data as any)?.id || '');
    if (!id) {
      throw new Error('Instagram did not return a comment id');
    }
    return { id };
  } catch (error) {
    actionsLogger.error('Failed to reply to comment', formatError(error));
    throw new Error(
      `Failed to reply to comment: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
