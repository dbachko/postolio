import axios from 'axios';
import { logger as baseLogger } from '@postolio/logger';
import { formatError } from '../utils/logging.js';

const commentsLogger = baseLogger.child({ module: 'instagram-messaging-comments' });
const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
const fbGraph = (path: string) => `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

type BrandData = { id: string };
type ServiceLike = any;

export async function setCommentHiddenImpl(
  service: ServiceLike,
  brand: BrandData | string,
  commentId: string,
  hide: boolean
): Promise<{ success: boolean }> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }

  try {
    const credentials = await service.getCredentialsOrThrow(brand);
    await service.checkRateLimit(String(credentials.accountId));
    const response = await axios.post(
      fbGraph(
        `${commentId}?hide=${hide ? 'true' : 'false'}&access_token=${credentials.accessToken}`
      )
    );
    return { success: Boolean((response.data as any)?.success ?? true) };
  } catch (error) {
    commentsLogger.error('Failed to set comment hidden', formatError(error));
    throw new Error(
      `Failed to ${hide ? 'hide' : 'unhide'} comment: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

export async function deleteCommentImpl(
  service: ServiceLike,
  brand: BrandData | string,
  commentId: string
): Promise<{ success: boolean }> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }

  try {
    const credentials = await service.getCredentialsOrThrow(brand);
    await service.checkRateLimit(String(credentials.accountId));
    await axios.delete(fbGraph(`${commentId}?access_token=${credentials.accessToken}`));
    return { success: true };
  } catch (error) {
    commentsLogger.error('Failed to delete comment', formatError(error));
    throw new Error(
      `Failed to delete comment: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export async function likeCommentImpl(
  service: ServiceLike,
  brand: BrandData | string,
  commentId: string
): Promise<{ success: boolean }> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }

  try {
    const credentials = await service.getCredentialsOrThrow(brand);
    await service.checkRateLimit(String(credentials.accountId));
    const response = await axios.post(fbGraph(`${commentId}/likes`), {
      access_token: credentials.accessToken,
    });
    return { success: Boolean((response.data as any)?.success ?? true) };
  } catch (error: any) {
    const message = (error?.response?.data?.error?.message as string) || (error as Error).message;
    if (/Unsupported|Invalid parameter|Unknown path|(#|code)\s?100|not allowed/i.test(message)) {
      throw new Error('Instagram API does not support liking comments for this account');
    }
    commentsLogger.error('Failed to like comment', formatError(error));
    throw new Error(`Failed to like comment: ${message || 'Unknown error'}`);
  }
}

export async function likeCommentForSocialAccountImpl(
  service: ServiceLike,
  socialAccountId: string,
  commentId: string
): Promise<{ success: boolean }> {
  try {
    const credentials = await service.getCredentialsOrThrowForSocialAccount(socialAccountId);
    await service.checkRateLimit(String(credentials.accountId));
    const response = await axios.post(fbGraph(`${commentId}/likes`), {
      access_token: credentials.accessToken,
    });
    return { success: Boolean((response.data as any)?.success ?? true) };
  } catch (error: any) {
    const message = (error?.response?.data?.error?.message as string) || (error as Error).message;
    if (/Unsupported|Invalid parameter|Unknown path|(#|code)\s?100|not allowed/i.test(message)) {
      throw new Error('Instagram API does not support liking comments for this account');
    }
    commentsLogger.error('Failed to like comment', formatError(error));
    throw new Error(`Failed to like comment: ${message || 'Unknown error'}`);
  }
}
