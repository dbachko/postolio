import axios from 'axios';
import { mapInstagramError } from '@postolio/errors';
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
  AccountMetrics,
} from '../types.js';

// Minimal Instagram connector mapping native → canonical
export class InstagramConnector implements Connector {
  readonly platform = 'instagram' as const;
  readonly capabilities = {
    publish: true,
    accountInsights: true,
    mediaInsights: true,
    comments: true,
    pagination: true,
    directMessages: true,
    bestTime: true,
  } as const;
  readonly rateLimits = { apiCallsPerHour: 200, postsPerDay: 25 } as const;

  async listRecentPosts(
    creds: Credentials,
    account: AccountIdentity,
    limit: number = 25,
    cursor?: string | null
  ): Promise<ListPostsResult> {
    try {
      const fields =
        'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count';
      let url = fbGraph(
        `${account.externalAccountId}/media?fields=${fields}&limit=${limit}&access_token=${creds.accessToken}`
      );
      if (cursor) url += `&after=${cursor}`;
      const res = await axios.get(url);
      const data = Array.isArray(res.data?.data) ? (res.data.data as any[]) : [];
      const posts: PostSummary[] = data.map((m) => ({
        id: String(m.id),
        caption: String(m.caption || ''),
        mediaType: m.media_type,
        mediaUrl: m.media_url,
        permalink: m.permalink,
        postedAt: m.timestamp,
        hashtags: (String(m.caption || '').match(/#\w+/g) || []).map((t: string) => t.substring(1)),
      }));
      const paging = res.data?.paging || {};
      return { data: posts, hasMore: !!paging.next, cursor: paging.cursors?.after || null };
    } catch (error) {
      throw mapInstagramError(error);
    }
  }

  async getMediaInsights(
    creds: Credentials,
    account: AccountIdentity,
    mediaId: string
  ): Promise<MediaMetrics> {
    void account; // not used in URL
    // Valid IG media insights (v24): drop 'engagement' (use total_interactions or derive)
    const metrics =
      'impressions,reach,saved,video_views,likes,comments,shares,total_interactions,views,plays';
    const buildUrl = (m: string) =>
      fbGraph(`${mediaId}/insights?metric=${m}&access_token=${creds.accessToken}`);
    let arr: any[] = [];
    try {
      const { data } = await axios.get(buildUrl(metrics));
      arr = Array.isArray(data?.data) ? (data.data as any[]) : [];
    } catch (err: any) {
      try {
        // Fallback: use a conservative set valid across most media types (no 'impressions')
        const fallback1 = 'reach,saved,likes,comments,shares,video_views';
        const { data } = await axios.get(buildUrl(fallback1));
        arr = Array.isArray(data?.data) ? (data.data as any[]) : [];
      } catch (err2: any) {
        try {
          // Final fallback: minimal core metrics
          const fallback2 = 'reach';
          const { data } = await axios.get(buildUrl(fallback2));
          arr = Array.isArray(data?.data) ? (data.data as any[]) : [];
        } catch (error) {
          throw mapInstagramError(error);
        }
      }
    }
    const m: Record<string, number> = {};
    for (const item of arr) {
      const name = item?.name as string | undefined;
      const value = item?.values?.[0]?.value as number | undefined;
      if (typeof name === 'string' && typeof value === 'number') {
        const canonical = name === 'saved' ? 'saves' : name;
        m[canonical] = value;
      }
    }
    // Derive engagement if not returned
    if (typeof m.engagement !== 'number') {
      const likes = m.likes || 0;
      const comments = m.comments || 0;
      const saves = m.saves || 0;
      const shares = m.shares || 0;
      m.engagement = likes + comments + saves + shares;
    }
    return { metrics: m as any, asOf: new Date().toISOString() };
  }

  async getMediaFields(
    creds: Credentials,
    account: AccountIdentity,
    mediaId: string
  ): Promise<Partial<Record<'likes' | 'comments', number>>> {
    void account;
    try {
      const url = fbGraph(
        `${mediaId}?fields=like_count,comments_count&access_token=${creds.accessToken}`
      );
      const { data } = await axios.get(url);
      return {
        likes: typeof data?.like_count === 'number' ? data.like_count : 0,
        comments: typeof data?.comments_count === 'number' ? data.comments_count : 0,
      };
    } catch (error) {
      throw mapInstagramError(error);
    }
  }

  async getAccountInsights(
    creds: Credentials,
    account: AccountIdentity,
    window: '7d' | '30d' | '90d' = '7d'
  ): Promise<AccountMetrics> {
    const end = new Date();
    const days = window === '7d' ? 7 : window === '30d' ? 30 : 90;
    const start = new Date();
    start.setDate(end.getDate() - days);

    // Prefer UNIX timestamps for since/until; fallback from YYYY-MM-DD caused 400 in some cases
    const sinceUnix = Math.floor(start.getTime() / 1000);
    const untilUnix = Math.floor(end.getTime() / 1000);

    let followers = 0;
    try {
      // Fetch followers_count separately (lifetime field)
      const profileUrl = fbGraph(
        `${account.externalAccountId}?fields=followers_count&access_token=${creds.accessToken}`
      );
      const profileRes = await axios.get(profileUrl);
      followers = Number(profileRes.data?.followers_count || 0);
    } catch (error) {
      throw mapInstagramError(error);
    }

    const fetchSeries = async (metricList: string) => {
      const url = fbGraph(
        `${account.externalAccountId}/insights?metric=${metricList}&period=day&since=${sinceUnix}&until=${untilUnix}&access_token=${creds.accessToken}`
      );
      return axios.get(url);
    };
    const fetchTotal = async (metricName: string) => {
      const url = fbGraph(
        `${account.externalAccountId}/insights?metric=${metricName}&metric_type=total_value&period=day&since=${sinceUnix}&until=${untilUnix}&access_token=${creds.accessToken}`
      );
      return axios.get(url);
    };
    const aggregateSeries = (data: any[]) => {
      const totals: Record<string, number> = {};
      for (const item of data) {
        const name = item?.name as string | undefined;
        const values = Array.isArray(item?.values) ? item.values : [];
        const sum = values.reduce(
          (s: number, v: any) => s + (typeof v?.value === 'number' ? v.value : 0),
          0
        );
        if (typeof name === 'string') totals[name] = sum;
      }
      return totals;
    };

    // reach (time series)
    let reachTotal = 0;
    try {
      const res = await fetchSeries('reach');
      const arr = Array.isArray(res.data?.data) ? (res.data.data as any[]) : [];
      const totals = aggregateSeries(arr);
      reachTotal = totals.reach || 0;
    } catch (err) {
      throw mapInstagramError(err);
    }

    // profile_views (total_value)
    let profileViews = 0;
    try {
      const res = await fetchTotal('profile_views');
      const arr = Array.isArray(res.data?.data) ? (res.data.data as any[]) : [];
      for (const item of arr) {
        if (item?.name === 'profile_views') {
          const tv = item?.total_value;
          if (typeof tv === 'number') profileViews += tv;
          else if (tv && typeof tv?.value === 'number') profileViews += tv.value;
          else {
            const values = Array.isArray(item?.values) ? item.values : [];
            profileViews += values.reduce(
              (s: number, v: any) => s + (typeof v?.value === 'number' ? v.value : 0),
              0
            );
          }
        }
      }
    } catch (err) {
      throw mapInstagramError(err);
    }

    return {
      metrics: {
        followers,
        reach: reachTotal,
        profile_views: profileViews,
      },
      asOf: new Date().toISOString(),
      period: 'day',
    };
  }

  /**
   * Publish content to Instagram using the Graph API.
   *
   * This implementation mirrors the legacy instagramService.publishMedia flow:
   *   1. Create a media container on the IG business account
   *   2. Publish the container
   *   3. Fetch the permalink for the published media
   *
   * It is intentionally side‑effect free: the caller is responsible for
   * persisting Content/ContentPublication records in their own datastore.
   */
  async publish(
    req: import('../types.js').PublishRequest,
    creds: Credentials,
    account: AccountIdentity
  ): Promise<import('../types.js').PublishResult> {
    try {
      if (!req.imageUrl && !req.mediaUrl) {
        throw new Error('cdnImageUrl/mediaUrl is required for Instagram publishing');
      }

      // Step 1: create media container
      const captionParts = [req.caption || ''];
      if (Array.isArray(req.hashtags) && req.hashtags.length > 0) {
        const tags = req.hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ');
        captionParts.push('', tags);
      }
      const caption = captionParts.join('\n').trim();

      const containerUrl = fbGraph(`${account.externalAccountId}/media`);
      const containerData: Record<string, string> = {
        // Legacy path only supported images; keep using image_url for now.
        image_url: req.imageUrl || (req.mediaUrl as string),
        caption,
        access_token: creds.accessToken,
      };

      const containerResponse = await axios.post(containerUrl, containerData);
      const containerId = containerResponse.data?.id;
      if (!containerId || typeof containerId !== 'string') {
        throw new Error('Failed to create Instagram media container');
      }

      // Step 2: publish the media container
      const publishUrl = fbGraph(`${account.externalAccountId}/media_publish`);
      const publishData = {
        creation_id: containerId,
        access_token: creds.accessToken,
      };
      const publishResponse = await axios.post(publishUrl, publishData);
      const mediaId = publishResponse.data?.id;
      if (!mediaId || typeof mediaId !== 'string') {
        throw new Error('Failed to publish Instagram media');
      }

      // Step 3: fetch permalink
      const permalinkUrl = fbGraph(`${mediaId}?fields=permalink&access_token=${creds.accessToken}`);
      const permalinkResponse = await axios.get(permalinkUrl);
      const permalink =
        typeof permalinkResponse.data?.permalink === 'string'
          ? permalinkResponse.data.permalink
          : undefined;

      return {
        externalPostId: mediaId,
        publishedAt: new Date().toISOString(),
        permalink,
        metadata: {
          mediaType: req.mediaType,
        },
      };
    } catch (error) {
      throw mapInstagramError(error);
    }
  }

  async getComments(
    creds: Credentials,
    account: AccountIdentity,
    mediaId: string,
    limit: number = 50
  ): Promise<{ data: import('../types.js').CommentItem[]; total?: number }> {
    void account;
    void creds;
    const url = fbGraph(
      `${mediaId}/comments?fields=id,text,username,timestamp,like_count&limit=${limit}&access_token=${creds.accessToken}`
    );
    try {
      const { data } = await axios.get(url);
      const arr = Array.isArray(data?.data) ? (data.data as any[]) : [];
      return {
        data: arr.map((c: any) => ({
          id: String(c.id || ''),
          text: typeof c.text === 'string' ? c.text : undefined,
          username: typeof c.username === 'string' ? c.username : undefined,
          createdAt: typeof c.timestamp === 'string' ? c.timestamp : undefined,
          likeCount: typeof c.like_count === 'number' ? c.like_count : undefined,
        })),
        total:
          typeof data?.summary?.total_count === 'number' ? data.summary.total_count : undefined,
      };
    } catch (error) {
      throw mapInstagramError(error);
    }
  }
}
