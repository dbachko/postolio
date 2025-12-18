import axios from 'axios';
import { mapFacebookError } from '@postolio/errors';
// Centralized Graph API version handling for easy bumps
const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
const fbGraph = (path: string) => `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;
import type {
  AccountIdentity,
  Connector,
  Credentials,
  ListPostsResult,
  MediaMetrics,
  PostSummary,
  PublishRequest,
  PublishResult,
} from '../types.js';

export class FacebookConnector implements Connector {
  readonly platform = 'facebook' as const;
  readonly capabilities = {
    publish: true,
    accountInsights: false,
    mediaInsights: false,
    comments: false,
    pagination: true,
    ads: false,
    directMessages: false,
    bestTime: false,
  } as const;
  readonly rateLimits = { apiCallsPerHour: 200, postsPerDay: 25 } as const;

  async listRecentPosts(
    creds: Credentials,
    account: AccountIdentity,
    limit: number = 25,
    cursor?: string | null
  ): Promise<ListPostsResult> {
    try {
      const pageId = account.externalPageId || account.externalAccountId;
      const fields =
        'id,message,created_time,permalink_url,full_picture,attachments{media_type,media{image,source}}';

      const res = await axios.get(fbGraph(`${pageId}/posts`), {
        params: {
          fields,
          limit,
          access_token: creds.accessToken,
          ...(cursor ? { after: cursor } : {}),
        },
      });

      const data = Array.isArray(res.data?.data) ? (res.data.data as any[]) : [];
      const posts: PostSummary[] = data.map((p) => {
        const id = String(p.id);
        const caption = typeof p.message === 'string' ? p.message : '';
        const postedAt = typeof p.created_time === 'string' ? p.created_time : undefined;
        const permalink = typeof p.permalink_url === 'string' ? p.permalink_url : undefined;
        const fullPicture = typeof p.full_picture === 'string' ? p.full_picture : undefined;

        const attachments = Array.isArray(p.attachments?.data) ? p.attachments.data : [];
        let mediaType: PostSummary['mediaType'] | undefined;
        let mediaUrl: string | undefined;

        for (const att of attachments) {
          const attType = typeof att.media_type === 'string' ? att.media_type.toLowerCase() : '';
          const source = typeof att.media?.source === 'string' ? att.media.source : undefined;
          const imageSrc =
            typeof att.media?.image?.src === 'string' ? att.media.image.src : undefined;

          if (!mediaType) {
            if (source) {
              mediaType = 'VIDEO';
              mediaUrl = source;
            } else if (attType.includes('video')) {
              // Avoid claiming VIDEO without a direct source URL; fall back to IMAGE if we have a thumbnail.
              mediaType = fullPicture ? 'IMAGE' : 'TEXT';
            } else if (attType.includes('album')) {
              mediaType = 'CAROUSEL_ALBUM';
            } else if (attType.includes('photo') || imageSrc || fullPicture) {
              mediaType = 'IMAGE';
            } else if (attType.includes('link')) {
              mediaType = 'LINK';
            }
          }

          if (!mediaUrl) {
            if (imageSrc) mediaUrl = imageSrc;
            else if (fullPicture) mediaUrl = fullPicture;
          }
        }

        if (!mediaType) {
          if (fullPicture) mediaType = 'IMAGE';
          else if (caption) mediaType = 'TEXT';
          else mediaType = 'TEXT';
        }

        return {
          id,
          caption,
          mediaType,
          mediaUrl,
          permalink,
          postedAt,
        };
      });

      const paging = res.data?.paging || {};
      return {
        data: posts,
        hasMore: Boolean(paging.next),
        cursor: paging.cursors?.after || null,
      };
    } catch (error) {
      throw mapFacebookError(error);
    }
  }

  async getMediaInsights(
    _creds: Credentials,
    _account: AccountIdentity,
    _mediaId: string
  ): Promise<MediaMetrics> {
    return { metrics: {}, asOf: new Date().toISOString() };
  }

  async publish(
    req: PublishRequest,
    creds: Credentials,
    account: AccountIdentity
  ): Promise<PublishResult> {
    try {
      const pageId = account.externalPageId || account.externalAccountId;
      const caption = (req.caption || '').trim();

      const mediaType = req.mediaType || 'IMAGE';
      const isVideo = mediaType === 'VIDEO' || mediaType === 'REELS' || mediaType === 'STORIES';

      if (isVideo) {
        const fileUrl = req.mediaUrl || req.imageUrl;
        if (!fileUrl) {
          throw new Error('mediaUrl is required for Facebook video publishing');
        }

        const uploadRes = await axios.post(fbGraph(`${pageId}/videos`), {
          file_url: fileUrl,
          description: caption,
          access_token: creds.accessToken,
        });

        const videoId = uploadRes.data?.id;
        if (!videoId || typeof videoId !== 'string') {
          throw new Error('Failed to publish Facebook video');
        }

        let permalink: string | undefined;
        try {
          const permalinkRes = await axios.get(fbGraph(`${videoId}`), {
            params: { fields: 'permalink_url', access_token: creds.accessToken },
          });
          if (typeof permalinkRes.data?.permalink_url === 'string') {
            permalink = permalinkRes.data.permalink_url;
          }
        } catch (_e) {
          // best-effort
        }

        return {
          externalPostId: videoId,
          publishedAt: new Date().toISOString(),
          permalink,
          metadata: { videoId },
        };
      }

      const imageUrl = req.imageUrl || req.mediaUrl;
      if (!imageUrl) {
        throw new Error('imageUrl is required for Facebook photo publishing');
      }

      const photoRes = await axios.post(fbGraph(`${pageId}/photos`), {
        url: imageUrl,
        caption,
        published: 'true',
        access_token: creds.accessToken,
      });

      const photoId = photoRes.data?.id;
      const postId = photoRes.data?.post_id;
      const externalPostId =
        typeof postId === 'string' && postId.trim()
          ? postId
          : typeof photoId === 'string' && photoId.trim()
            ? photoId
            : null;
      if (!externalPostId) {
        throw new Error('Failed to publish Facebook photo');
      }

      let permalink: string | undefined;
      const permalinkId = typeof postId === 'string' && postId.trim() ? postId : externalPostId;
      try {
        const permalinkRes = await axios.get(fbGraph(`${permalinkId}`), {
          params: { fields: 'permalink_url', access_token: creds.accessToken },
        });
        if (typeof permalinkRes.data?.permalink_url === 'string') {
          permalink = permalinkRes.data.permalink_url;
        }
      } catch (_e) {
        // best-effort
      }

      return {
        externalPostId,
        publishedAt: new Date().toISOString(),
        permalink,
        metadata: {
          postId: typeof postId === 'string' ? postId : undefined,
          photoId: typeof photoId === 'string' ? photoId : undefined,
        },
      };
    } catch (error) {
      throw mapFacebookError(error);
    }
  }
}
