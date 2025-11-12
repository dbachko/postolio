import { PrismaClient } from '@postolio/database';
import axios from 'axios';
import fetch from 'node-fetch';
import Redis from 'ioredis';
import { signRequest } from '@postolio/aws';

function ensureDatabaseUrl() {
  if (process.env.DATABASE_URL) return;
  const { DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME } = process.env as Record<
    string,
    string | undefined
  >;
  if (DB_HOST && DB_PORT && DB_USERNAME && DB_PASSWORD && DB_NAME) {
    const enc = encodeURIComponent;
    process.env.DATABASE_URL = `postgresql://${enc(DB_USERNAME)}:${enc(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public`;
    console.log('[CommentsIngestor] DATABASE_URL constructed from DB_* vars', {
      dbHost: DB_HOST,
      dbPort: DB_PORT,
      dbName: DB_NAME,
    });
  }
}

ensureDatabaseUrl();

const prisma = new PrismaClient();
const redis = new Redis(
  process.env.REDIS_URL || process.env.REDIS_URI || 'redis://localhost:6379',
  { enableReadyCheck: false }
);

const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
const fbGraph = (path: string) => `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

type Credentials = { accessToken: string; expiresAt?: string };

async function getCredentialsForBrand(userId: string, brandId: string): Promise<Credentials> {
  const tokenServiceUrl = process.env.TOKEN_SERVICE_URL || process.env.TOKEN_SERVICE_FUNCTION_URL;
  if (!tokenServiceUrl) throw new Error('Missing TOKEN_SERVICE_URL');
  const url = new URL(`${tokenServiceUrl}/tokens/${userId}/instagram/${brandId}`);
  const headers = await signRequest({ method: 'GET', url, headers: {} });
  const res = await fetch(url.toString(), { method: 'GET', headers });
  if (!res.ok) throw new Error(`Token Service error: ${res.status}`);
  const data = (await res.json()) as Credentials;
  if (!data.accessToken) throw new Error('Token Service returned no accessToken');
  return data;
}

async function fetchPostComments(accessToken: string, mediaId: string, limit: number) {
  const url = fbGraph(
    `${mediaId}/comments?fields=id,text,username,timestamp,like_count&limit=${limit}&access_token=${accessToken}`
  );
  const { data } = await axios.get(url);
  const arr = Array.isArray(data?.data) ? (data.data as any[]) : [];
  return arr.map((c) => ({
    id: String(c.id || ''),
    text: typeof c.text === 'string' ? c.text : undefined,
    username: typeof c.username === 'string' ? c.username : undefined,
    timestamp: typeof c.timestamp === 'string' ? c.timestamp : undefined,
  }));
}

async function ingestForBrand(brandId: string, maxPosts = 50, perPostLimit = 100) {
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { id: true, userId: true, instagramAccountId: true, instagramPageId: true },
  });
  if (!brand?.instagramAccountId || !brand.instagramPageId)
    throw new Error('Brand not connected to Instagram');

  const pubs = await prisma.contentPublication.findMany({
    where: { content: { brandId }, platform: 'instagram' },
    orderBy: { publishedAt: 'desc' },
    take: Math.max(1, Math.min(maxPosts, 200)),
    select: { id: true, externalPostId: true },
  });

  const creds = await getCredentialsForBrand(brand.userId, brand.id);
  let upserted = 0;
  for (const pub of pubs) {
    if (!pub.externalPostId) continue;
    const cacheKey = `ingest:comments:pub:${pub.id}`;
    const recent = await redis.get(cacheKey);
    if (recent) continue; // skip recently ingested
    try {
      const comments = await fetchPostComments(
        creds.accessToken,
        String(pub.externalPostId),
        perPostLimit
      );
      for (const c of comments) {
        await prisma.publicationComment.upsert({
          where: {
            publicationId_externalCommentId: {
              publicationId: pub.id,
              externalCommentId: c.id,
            },
          } as any,
          update: {
            text: c.text || null,
            authorUsername: c.username || null,
          },
          create: {
            publicationId: pub.id,
            platform: 'instagram',
            externalCommentId: c.id,
            text: c.text || null,
            authorUsername: c.username || null,
            status: 'open',
            createdAt: c.timestamp ? new Date(c.timestamp) : undefined,
          },
        });
        upserted++;
      }
      await redis.setex(cacheKey, 10 * 60, '1'); // 10m
    } catch (e: any) {
      console.warn('[CommentsIngestor] Failed for pub', pub.id, e?.message || String(e));
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { postsProcessed: pubs.length, commentsUpserted: upserted };
}

export async function runOnce() {
  // Loop through IG-connected brands
  const brands = await prisma.brand.findMany({
    select: { id: true, userId: true, instagramAccountId: true, instagramPageId: true },
    where: { instagramAccountId: { not: null }, instagramPageId: { not: null } },
    take: 200,
  });
  let total = 0;
  for (const b of brands) {
    try {
      const res = await ingestForBrand(
        b.id,
        Number(process.env.COMMENTS_MAX_POSTS || 50),
        Number(process.env.COMMENTS_PER_POST_LIMIT || 100)
      );
      total += res.commentsUpserted;
    } catch (e: any) {
      console.warn('[CommentsIngestor] Brand failed', b.id, e?.message || String(e));
    }
  }
  const hadWork = total > 0;
  return { hadWork };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const loopMs = Number(process.env.COMMENTS_INGESTOR_LOOP_MS || '0');
  if (loopMs > 0) {
    (async () => {
      while (true) {
        try {
          const { hadWork } = await runOnce();
          const sleepMs = hadWork ? loopMs : Number(process.env.IDLE_BACKOFF_MS || 5 * 60 * 1000);
          await new Promise((r) => setTimeout(r, sleepMs));
        } catch (e) {
          console.error('CommentsIngestor loop error', e);
          await new Promise((r) => setTimeout(r, loopMs));
        }
      }
    })();
  } else {
    runOnce()
      .then(() => process.exit(0))
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  }
}
