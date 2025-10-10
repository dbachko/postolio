#!/usr/bin/env -S pnpm tsx
/*
  Capture latest Instagram posts for a brand into a fixture file.

  Usage:
    pnpm tsx scripts/capture-instagram-posts.ts <brandId> [limit]

  Env:
    - DATABASE_URL (for Prisma)
    - Token/SSO envs used by PublisherCredentialsService (if applicable)
*/
import { PrismaClient } from '@postolio/database';
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
  const prisma = new PrismaClient();
  try {
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new Error(`Brand not found: ${brandId}`);
    const brandForIg = {
      id: brand.id,
      instagramAccountId: brand.instagramAccountId,
      instagramPageId: brand.instagramPageId,
    };
    if (!instagramService.isConfigured(brandForIg)) {
      throw new Error('Instagram not connected for this brand (missing accountId/pageId)');
    }
    const posts = await instagramService.getRecentPosts(brandForIg, Math.min(limit, 25));
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
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
