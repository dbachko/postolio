#!/usr/bin/env -S pnpm tsx
/*
  Capture latest Instagram posts for a brand into a fixture file.

  Usage:
    pnpm tsx scripts/capture-instagram-posts.ts <brandId> [limit]

  Env:
    - DATABASE_URL (for Prisma)
    - Token/SSO envs used by PublisherCredentialsService (if applicable)
*/
import { createPrismaClient } from '@postolio/database';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

// Import the instagramService from API package
// Note: The service fetches credentials from Token Service. Ensure staging/dev has creds.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { instagramService } from '../packages/apps/api/src/services/instagram.ts';

async function main() {
  const [brandId, limitArg] = process.argv.slice(2);
  if (!brandId) {
    console.error('Usage: pnpm tsx scripts/capture-instagram-posts.ts <brandId> [limit]');
    process.exit(2);
  }
  const limit = Number(limitArg || 20);
  const { client: prisma, pool } = createPrismaClient({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new Error(`Brand not found: ${brandId}`);
    // Ensure Instagram is connected via SocialAccount + Token Service
    const instagramConnected = await instagramService.isConfigured({ id: brand.id });
    if (!instagramConnected) {
      throw new Error('Instagram not connected for this brand');
    }

    // Fetch recent posts using the connector-aware instagramService implementation
    const posts = await instagramService.getRecentPosts({ id: brand.id }, Math.min(limit, 25));
    const when = new Date();
    const stamp = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}${String(
      when.getDate()
    ).padStart(2, '0')}_${String(when.getHours()).padStart(2, '0')}${String(
      when.getMinutes()
    ).padStart(2, '0')}${String(when.getSeconds()).padStart(2, '0')}`;
    const dir = path.join('fixtures', 'brand-analysis', brandId);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `posts-${stamp}.json`);
    await writeFile(
      file,
      JSON.stringify({ brandId, capturedAt: when.toISOString(), posts }, null, 2)
    );
    console.log(`Wrote ${posts.length} posts to ${file}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
