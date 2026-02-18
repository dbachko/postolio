#!/usr/bin/env -S pnpm tsx
/*
  Capture public posts from another Instagram Business/Creator account using the
  Instagram Graph API Business Discovery endpoint.

  Requirements:
  - You must have a requesting Instagram Business/Creator account connected in our system
    (a brand with instagramAccountId + instagramPageId). We will use its token.
  - The target username must be a public Business/Creator account.

  Usage:
    pnpm tsx scripts/capture-ig-business-discovery.ts \
      --requesterBrand <brandId> --username <ig_username> [--limit 20]

  Env:
    - DATABASE_URL (for Prisma)
    - Token Service envs used by PublisherCredentialsService
*/
import { createPrismaClient } from '@postolio/database';
import { PublisherCredentialsService } from '../packages/apps/api/src/services/publisher-credentials.js';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

type Args = { requesterBrand: string; username: string; limit: number };

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--requesterBrand') out.requesterBrand = args[++i];
    else if (a === '--username') out.username = args[++i];
    else if (a === '--limit') out.limit = Number(args[++i]);
  }
  if (!out.requesterBrand || !out.username) {
    console.error(
      'Usage: pnpm tsx scripts/capture-ig-business-discovery.ts --requesterBrand <brandId> --username <ig_username> [--limit 20]'
    );
    process.exit(2);
  }
  return { requesterBrand: out.requesterBrand, username: out.username, limit: out.limit || 20 };
}

async function main() {
  const { client: prisma, pool } = createPrismaClient({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    const { requesterBrand, username, limit } = parseArgs();
    const reqBrand = await prisma.brand.findUnique({ where: { id: requesterBrand } });
    if (!reqBrand) throw new Error(`Requester brand not found: ${requesterBrand}`);

    const creds = await PublisherCredentialsService.getPublishingCredentials(requesterBrand);
    if (!creds || !creds.accessToken || !creds.accountId) {
      throw new Error('Missing requester brand IG credentials (access token/accountId)');
    }

    // Build Business Discovery request
    const fields = `business_discovery.username(${encodeURIComponent(username)}){media.limit(${Math.min(
      limit,
      25
    )}){id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count}}`;
    const url = new URL(`https://graph.facebook.com/v23.0/${creds.accountId}`);
    url.searchParams.set('fields', fields);
    url.searchParams.set('access_token', creds.accessToken);

    const resp = await fetch(url.toString(), { method: 'GET' });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Business Discovery HTTP ${resp.status}: ${txt}`);
    }
    const json = (await resp.json()) as any;
    const media = json?.business_discovery?.media?.data || [];
    if (!Array.isArray(media) || media.length === 0) {
      throw new Error(
        'No media returned by Business Discovery (account private, not business/creator, or insufficient permissions).'
      );
    }

    const posts = media.map((m: any) => {
      const caption: string = m.caption || '';
      const hashtagMatches = caption.match(/#\w+/g) || [];
      const hashtags = hashtagMatches.map((t: string) => t.substring(1));
      return {
        id: m.id,
        caption,
        media_type: m.media_type,
        media_url: m.media_url,
        permalink: m.permalink,
        timestamp: m.timestamp,
        hashtags,
        like_count: m.like_count,
        comments_count: m.comments_count,
      };
    });

    const when = new Date();
    const stamp = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}${String(
      when.getDate()
    ).padStart(2, '0')}_${String(when.getHours()).padStart(2, '0')}${String(
      when.getMinutes()
    ).padStart(2, '0')}${String(when.getSeconds()).padStart(2, '0')}`;
    const dir = path.join('fixtures', 'brand-analysis', username);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `public-posts-${stamp}.json`);
    await writeFile(
      file,
      JSON.stringify(
        {
          source: 'business_discovery',
          requesterBrand,
          username,
          capturedAt: when.toISOString(),
          posts,
        },
        null,
        2
      )
    );
    console.log(`Wrote ${posts.length} posts from @${username} to ${file}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
