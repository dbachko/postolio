import axios from 'axios';
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
    publish: false, // publishing handled elsewhere for now
    accountInsights: true,
    mediaInsights: true,
    comments: true,
    pagination: true,
  } as const;
  readonly rateLimits = { apiCallsPerHour: 200 } as const;

  async listRecentPosts(
    creds: Credentials,
    account: AccountIdentity,
    limit: number = 25,
    cursor?: string | null
  ): Promise<ListPostsResult> {
    const fields = 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count';
    let url = `https://graph.facebook.com/v23.0/${account.externalAccountId}/media?fields=${fields}&limit=${limit}&access_token=${creds.accessToken}`;
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
  }

  async getMediaInsights(
    creds: Credentials,
    account: AccountIdentity,
    mediaId: string
  ): Promise<MediaMetrics> {
    void account; // not used in URL
    // Only use valid IG media insights metrics
    const metrics = 'impressions,reach,engagement,saved,video_views';
    const url = `https://graph.facebook.com/v23.0/${mediaId}/insights?metric=${metrics}&access_token=${creds.accessToken}`;
    const { data } = await axios.get(url);
    const arr = Array.isArray(data?.data) ? (data.data as any[]) : [];
    const m: Record<string, number> = {};
    for (const item of arr) {
      const name = item?.name as string | undefined;
      const value = item?.values?.[0]?.value as number | undefined;
      if (typeof name === 'string' && typeof value === 'number') {
        const canonical = name === 'saved' ? 'saves' : name;
        m[canonical] = value;
      }
    }
    return { metrics: m as any, asOf: new Date().toISOString() };
  }

  async getMediaFields(
    creds: Credentials,
    account: AccountIdentity,
    mediaId: string
  ): Promise<Partial<Record<'likes' | 'comments', number>>> {
    void account;
    const url = `https://graph.facebook.com/v23.0/${mediaId}?fields=like_count,comments_count&access_token=${creds.accessToken}`;
    const { data } = await axios.get(url);
    return {
      likes: typeof data?.like_count === 'number' ? data.like_count : 0,
      comments: typeof data?.comments_count === 'number' ? data.comments_count : 0,
    };
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
    const since = start.toISOString().split('T')[0];
    const until = end.toISOString().split('T')[0];

    // Fetch followers_count separately (lifetime field)
    const profileUrl = `https://graph.facebook.com/v23.0/${account.externalAccountId}?fields=followers_count&access_token=${creds.accessToken}`;
    const profileRes = await axios.get(profileUrl);
    const followers = Number(profileRes.data?.followers_count || 0);

    const metrics = 'impressions,reach,profile_views';
    const url = `https://graph.facebook.com/v23.0/${account.externalAccountId}/insights?metric=${metrics}&period=day&since=${since}&until=${until}&access_token=${creds.accessToken}`;
    const res = await axios.get(url);
    const arr = Array.isArray(res.data?.data) ? (res.data.data as any[]) : [];
    // Aggregate last day totals (we will store series at ingestion side)
    const totals: Record<string, number> = {};
    for (const item of arr) {
      const name = item?.name as string | undefined;
      const values = Array.isArray(item?.values) ? item.values : [];
      const sum = values.reduce(
        (s: number, v: any) => s + (typeof v?.value === 'number' ? v.value : 0),
        0
      );
      if (typeof name === 'string') totals[name] = sum;
    }
    return {
      metrics: {
        followers,
        impressions: totals.impressions || 0,
        reach: totals.reach || 0,
        profile_views: totals.profile_views || 0,
      },
      asOf: new Date().toISOString(),
      period: 'day',
    };
  }
}
