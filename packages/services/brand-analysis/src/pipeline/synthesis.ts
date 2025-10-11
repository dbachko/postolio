import type { z } from 'zod';
import { BrandStyleProfileSchema } from '../models/profile-schema';

export type BrandStyleProfileModel = z.infer<typeof BrandStyleProfileSchema>;

export function synthesizeProfile(input: Record<string, unknown>): BrandStyleProfileModel {
  const brandId = typeof input.brandId === 'string' ? (input.brandId as string) : 'unknown';
  const version = typeof input.version === 'number' ? (input.version as number) : 1;
  const promptSetVersion =
    typeof input.promptSetVersion === 'string' ? (input.promptSetVersion as string) : 'v2';

  const tone = Array.isArray(input.textTone)
    ? (input.textTone as unknown[]).filter((v) => typeof v === 'string').slice(0, 10)
    : [];

  const draft = {
    brandId,
    version,
    promptSetVersion,
    createdAt: new Date().toISOString(),
    text: { tone },
  } as unknown;

  const parsed = BrandStyleProfileSchema.safeParse(draft);
  if (!parsed.success) {
    throw new Error('Invalid profile draft');
  }
  return parsed.data;
}
