#!/usr/bin/env -S pnpm tsx
/*
  Offline replay of Brand Analysis using a captured posts fixture.

  Usage:
    pnpm tsx scripts/replay-brand-analysis.ts --brand <brandId> --fixture <path> [--out <dir>] [--print]

  Env:
    - OPENAI_API_KEY (optional, to enable vision)
*/
import { readFile, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { BrandAnalysisOrchestrator } from '../packages/services/brand-analysis/src/orchestrator';

type ReplayArgs = { brand: string; fixture: string; out?: string; print?: boolean };

function parseArgs(): ReplayArgs {
  const args = process.argv.slice(2);
  const out: ReplayArgs = { brand: '', fixture: '' } as ReplayArgs;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--brand') out.brand = args[++i];
    else if (a === '--fixture') out.fixture = args[++i];
    else if (a === '--out') out.out = args[++i];
    else if (a === '--print') out.print = true;
  }
  if (!out.brand || !out.fixture) {
    console.error(
      'Usage: pnpm tsx scripts/replay-brand-analysis.ts --brand <brandId> --fixture <path> [--out <dir>] [--print]'
    );
    process.exit(2);
  }
  return out;
}

async function main() {
  const { brand, fixture, out, print } = parseArgs();
  const data = JSON.parse(await readFile(fixture, 'utf8')) as {
    brandId?: string;
    posts: Array<{
      id: string;
      caption?: string;
      hashtags?: string[];
      timestamp?: string;
      like_count?: number;
      comments_count?: number;
      media_type?: string;
      media_url?: string;
    }>;
  };
  if (!Array.isArray(data.posts) || data.posts.length === 0) {
    throw new Error('Fixture contains no posts');
  }
  const orch = new BrandAnalysisOrchestrator();
  const { jobId, profile } = await orch.runBrandAnalysis(brand, { force: true }, data.posts);
  if (!profile) {
    console.log(`Reused running job ${jobId}; no profile generated`);
    return;
  }
  const profileJson = JSON.stringify(profile, null, 2);
  const hash = crypto.createHash('sha256').update(profileJson).digest('hex').slice(0, 8);
  const baseOutDir = out || path.join('fixtures', 'brand-analysis', brand);
  await mkdir(baseOutDir, { recursive: true });
  const fname = `profile-v${(profile as any).version}-${hash}.json`;
  const outFile = path.join(baseOutDir, fname);
  await writeFile(outFile, profileJson);
  console.log(`Wrote profile to ${outFile}`);

  if (print) {
    console.log('Summary:', {
      brandId: (profile as any).brandId,
      version: (profile as any).version,
      tones: (profile as any).text?.tone,
      palette: (profile as any).visual?.palette,
      motifs: (profile as any).visual?.motifs,
      topics: (profile as any).topics?.slice?.(0, 10),
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
