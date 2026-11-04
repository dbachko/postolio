import axios from 'axios';
import { logger as baseLogger } from '@postolio/logger';
import { formatError } from '../utils/logging.js';
import { extractHashtagsFromCaption } from '../utils/hashtag-extractor.js';
import type {
  BrandData,
  InstagramComment,
  InstagramPost,
  InstagramProfile,
  MediaInsightMetric,
  PublishMediaRequest,
  PublishMediaResult,
} from './instagram.js';

const profileLogger = baseLogger.child({ module: 'instagram-profile-ops' });
const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
const fbGraph = (path: string) => `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

type ServiceLike = any;

export async function refreshAccessTokenImpl(
  _service: ServiceLike,
  currentToken: string
): Promise<{ accessToken: string; expiresAt: string } | null> {
  try {
    const url = fbGraph(
      `oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_APP_SECRET}&fb_exchange_token=${currentToken}`
    );
    const response = await axios.get(url);
    const data = response.data;

    if (!data.access_token) {
      return null;
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    return {
      accessToken: data.access_token,
      expiresAt,
    };
  } catch (error) {
    profileLogger.error('Token refresh failed', formatError(error));
    return null;
  }
}

export async function getProfileImpl(
  service: ServiceLike,
  brand: BrandData | string
): Promise<InstagramProfile> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }

  try {
    const credentials = await service.getCredentialsOrThrow(brand);
    await service.checkRateLimit(String(credentials.accountId));
    const fields =
      'id,username,name,biography,followers_count,media_count,profile_picture_url,website';
    const response = await axios.get(
      fbGraph(`${credentials.accountId}?fields=${fields}&access_token=${credentials.accessToken}`)
    );
    const profile = response.data;

    return {
      id: profile.id,
      username: profile.username,
      account_type: 'BUSINESS',
      media_count: profile.media_count || 0,
      followers_count: profile.followers_count || 0,
      follows_count: profile.follows_count || 0,
      name: profile.name || '',
      biography: profile.biography || '',
      website: profile.website || '',
      profile_picture_url: profile.profile_picture_url || service.getDefaultProfilePicture(),
    };
  } catch (error) {
    profileLogger.error('Failed to fetch Instagram profile', formatError(error));
    throw new Error(
      `Failed to fetch Instagram profile: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
}

export async function getRecentPostsImpl(
  service: ServiceLike,
  brand: BrandData | string,
  limit = 25
): Promise<InstagramPost[]> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }

  try {
    const credentials = await service.getCredentialsOrThrow(brand);
    await service.checkRateLimit(String(credentials.accountId));
    const fields = 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count';
    const response = await axios.get(
      fbGraph(
        `${credentials.accountId}/media?fields=${fields}&limit=${limit}&access_token=${credentials.accessToken}`
      )
    );
    const mediaData = response.data.data || [];

    return mediaData.map((media: any) => {
      const caption = media.caption || '';
      return {
        id: media.id,
        caption,
        media_type: media.media_type,
        media_url: media.media_url,
        permalink: media.permalink,
        timestamp: media.timestamp,
        like_count: media.like_count,
        comments_count: media.comments_count,
        hashtags: extractHashtagsFromCaption(caption),
      };
    });
  } catch (error) {
    profileLogger.error('Failed to fetch Instagram posts', formatError(error));
    throw new Error(
      `Failed to fetch Instagram posts: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
}

export async function getRecentPostsPaginatedImpl(
  service: ServiceLike,
  brand: BrandData | string,
  limit = 25,
  cursor?: string | null
): Promise<{ data: InstagramPost[]; hasMore: boolean; cursor: string | null }> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }

  const credentials = await service.getCredentialsOrThrow(brand);
  const fields = 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count';
  let url = fbGraph(
    `${credentials.accountId}/media?fields=${fields}&limit=${limit}&access_token=${credentials.accessToken}`
  );
  if (cursor) {
    url += `&after=${cursor}`;
  }

  const response = await axios.get(url);
  const mediaData = response.data.data || [];
  const paging = response.data.paging || {};
  const posts: InstagramPost[] = mediaData.map((media: any) => ({
    id: String(media.id || ''),
    caption: media.caption || '',
    media_type: media.media_type || 'IMAGE',
    media_url: media.media_url || '',
    permalink: media.permalink || '',
    timestamp: media.timestamp || '',
    like_count: media.like_count,
    comments_count: media.comments_count,
  }));
  return {
    data: posts,
    hasMore: Boolean(paging.next),
    cursor: paging.cursors?.after || null,
  };
}

export async function publishMediaImpl(
  service: ServiceLike,
  brand: BrandData | string,
  request: PublishMediaRequest
): Promise<PublishMediaResult> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }

  try {
    const credentials = await service.getCredentialsOrThrow(brand);
    await service.checkRateLimit(String(credentials.accountId));

    const containerResponse = await axios.post(fbGraph(`${credentials.accountId}/media`), {
      image_url: request.cdnImageUrl,
      caption: request.caption,
      access_token: credentials.accessToken,
    });
    const containerId = containerResponse.data.id;

    const publishResponse = await axios.post(fbGraph(`${credentials.accountId}/media_publish`), {
      creation_id: containerId,
      access_token: credentials.accessToken,
    });
    const mediaId = publishResponse.data.id;

    const permalinkResponse = await axios.get(
      fbGraph(`${mediaId}?fields=permalink&access_token=${credentials.accessToken}`)
    );
    return {
      id: mediaId,
      permalink: permalinkResponse.data.permalink,
      published: true,
    };
  } catch (error) {
    profileLogger.error('Failed to publish Instagram media', formatError(error));
    throw new Error(
      `Failed to publish Instagram media: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
}

export async function getMediaInsightsImpl(
  service: ServiceLike,
  brand: BrandData | string,
  mediaId: string
): Promise<MediaInsightMetric[]> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }

  try {
    const credentials = await service.getCredentialsOrThrow(brand);
    await service.checkRateLimit(String(credentials.accountId));
    const metrics = 'impressions,reach,engagement,likes,comments,saves,shares';
    const response = await axios.get(
      fbGraph(`${mediaId}/insights?metric=${metrics}&access_token=${credentials.accessToken}`)
    );
    const data = response.data?.data;
    return Array.isArray(data) ? (data as MediaInsightMetric[]) : [];
  } catch (error) {
    profileLogger.error('Failed to fetch media insights', formatError(error));
    throw new Error(
      `Failed to fetch media insights: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
}

function mapComments(commentsRaw: unknown[]): InstagramComment[] {
  return commentsRaw.map((comment) => {
    const obj = comment as Record<string, unknown>;
    return {
      id: String(obj.id ?? ''),
      text: typeof obj.text === 'string' ? obj.text : undefined,
      username: typeof obj.username === 'string' ? obj.username : undefined,
      timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : undefined,
      like_count: typeof obj.like_count === 'number' ? obj.like_count : undefined,
    };
  });
}

export async function getPostCommentsImpl(
  service: ServiceLike,
  brand: BrandData | string,
  mediaId: string,
  limit = 25
): Promise<{ data: InstagramComment[]; total: number }> {
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }

  try {
    const credentials = await service.getCredentialsOrThrow(brand);
    await service.checkRateLimit(String(credentials.accountId));
    const countResponse = await axios.get(
      fbGraph(`${mediaId}?fields=comments_count&access_token=${credentials.accessToken}`)
    );
    const total = countResponse.data.comments_count || 0;

    const response = await axios.get(
      fbGraph(
        `${mediaId}/comments?fields=id,text,username,timestamp,like_count&limit=${limit}&access_token=${credentials.accessToken}`
      )
    );
    const commentsRaw = Array.isArray(response.data?.data) ? response.data.data : [];
    return { data: mapComments(commentsRaw), total };
  } catch (error) {
    profileLogger.error('Failed to fetch post comments', formatError(error));
    throw new Error(
      `Failed to fetch post comments: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
}

export async function getPostCommentsForSocialAccountImpl(
  service: ServiceLike,
  socialAccountId: string,
  mediaId: string,
  limit = 25
): Promise<{ data: InstagramComment[]; total: number }> {
  try {
    const credentials = await service.getCredentialsOrThrowForSocialAccount(socialAccountId);
    await service.checkRateLimit(String(credentials.accountId));
    const countResponse = await axios.get(
      fbGraph(`${mediaId}?fields=comments_count&access_token=${credentials.accessToken}`)
    );
    const total = countResponse.data.comments_count || 0;

    const response = await axios.get(
      fbGraph(
        `${mediaId}/comments?fields=id,text,username,timestamp,like_count&limit=${limit}&access_token=${credentials.accessToken}`
      )
    );
    const commentsRaw = Array.isArray(response.data?.data) ? response.data.data : [];
    return { data: mapComments(commentsRaw), total };
  } catch (error) {
    profileLogger.error('Failed to fetch post comments', formatError(error));
    throw new Error(
      `Failed to fetch post comments: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
}
