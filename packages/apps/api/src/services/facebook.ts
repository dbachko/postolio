import axios from 'axios';
import { logger as baseLogger } from '@postolio/logger';
import { formatError } from '../utils/logging.js';
import { PublisherCredentialsService } from './publisher-credentials.js';

const facebookLogger = baseLogger.child({ module: 'facebook-service' });

const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
const fbGraph = (path: string) => `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

type FacebookComment = {
  id?: unknown;
  message?: unknown;
  from?: { id?: unknown; name?: unknown } | null;
  created_time?: unknown;
  like_count?: unknown;
};

type FacebookCommentsResponse = {
  data?: unknown;
  summary?: { total_count?: unknown } | null;
};

type PlatformComment = {
  id: string;
  text: string | undefined;
  username: string | undefined;
  timestamp: string | undefined;
  like_count: number | undefined;
};

async function getCredentialsOrThrowForSocialAccount(socialAccountId: string): Promise<{
  accessToken: string;
}> {
  const credentials =
    await PublisherCredentialsService.getCredentialsForSocialAccount(socialAccountId);
  if (!credentials?.accessToken) {
    throw new Error('Facebook is not connected for this social account');
  }
  if (String(credentials.platform) !== 'facebook') {
    throw new Error('Social account is not a Facebook account');
  }
  return { accessToken: credentials.accessToken };
}

export const facebookService = {
  async getPostCommentsForSocialAccount(
    socialAccountId: string,
    postId: string,
    limit = 25
  ): Promise<{ data: PlatformComment[]; total: number }> {
    try {
      const credentials = await getCredentialsOrThrowForSocialAccount(socialAccountId);
      const res = await axios.get<FacebookCommentsResponse>(fbGraph(`${postId}/comments`), {
        params: {
          fields: 'id,message,from,created_time,like_count',
          limit,
          summary: true,
          access_token: credentials.accessToken,
        },
      });

      const raw = Array.isArray(res.data?.data) ? (res.data.data as FacebookComment[]) : [];
      const totalRaw = (res.data?.summary as any)?.total_count;
      const total = typeof totalRaw === 'number' ? totalRaw : raw.length;

      const data = raw
        .map((c) => {
          const id = typeof c.id === 'string' ? c.id : String(c.id || '');
          if (!id) {
            return null;
          }
          return {
            id,
            text: typeof c.message === 'string' ? c.message : undefined,
            username: typeof c.from?.name === 'string' ? c.from.name : undefined,
            timestamp: typeof c.created_time === 'string' ? c.created_time : undefined,
            like_count: typeof c.like_count === 'number' ? c.like_count : undefined,
          };
        })
        .filter((c): c is PlatformComment => Boolean(c));

      return { data, total };
    } catch (error) {
      facebookLogger.error('Failed to fetch Facebook post comments', formatError(error));
      throw new Error(
        `Failed to fetch Facebook post comments: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  },

  async replyToCommentForSocialAccount(
    socialAccountId: string,
    commentId: string,
    message: string
  ): Promise<{ id: string }> {
    if (!message?.trim()) {
      throw new Error('Reply message must not be empty');
    }

    try {
      const credentials = await getCredentialsOrThrowForSocialAccount(socialAccountId);
      const res = await axios.post(fbGraph(`${commentId}/comments`), {
        message,
        access_token: credentials.accessToken,
      });
      const id = String((res.data as any)?.id || '');
      if (!id) {
        throw new Error('Facebook did not return a comment id');
      }
      return { id };
    } catch (error) {
      facebookLogger.error('Failed to reply to Facebook comment', formatError(error));
      throw new Error(
        `Failed to reply to Facebook comment: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  },

  async likeCommentForSocialAccount(
    socialAccountId: string,
    commentId: string
  ): Promise<{ success: boolean }> {
    try {
      const credentials = await getCredentialsOrThrowForSocialAccount(socialAccountId);
      const res = await axios.post(fbGraph(`${commentId}/likes`), {
        access_token: credentials.accessToken,
      });
      const ok = Boolean((res.data as any)?.success ?? true);
      return { success: ok };
    } catch (error: any) {
      const message =
        (error?.response?.data?.error?.message as string) || (error as Error).message || '';
      facebookLogger.error('Failed to like Facebook comment', formatError(error));
      throw new Error(`Failed to like Facebook comment: ${message || 'Unknown error'}`, {
        cause: error,
      });
    }
  },
};
