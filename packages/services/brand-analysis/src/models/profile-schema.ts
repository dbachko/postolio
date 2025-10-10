import { z } from 'zod';

export const TextSectionSchema = z.object({
  tone: z.array(z.string()).default([]),
  styleNotes: z.array(z.string()).default([]).optional(),
});

export const VisualSectionSchema = z.object({
  palette: z.array(z.string()).default([]).optional(),
  motifs: z.array(z.string()).default([]).optional(),
  composition: z.array(z.string()).default([]).optional(),
});

export const BrandStyleProfileSchema = z.object({
  brandId: z.string(),
  version: z.number().int().min(1),
  promptSetVersion: z.string(),
  createdAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'createdAt must be ISO date'),
  dataQuality: z.enum(['SUFFICIENT', 'LIMITED', 'INSUFFICIENT']).optional(),
  text: TextSectionSchema,
  visual: VisualSectionSchema.optional(),
  topics: z.array(z.object({ value: z.string(), count: z.number().int().min(1) })).optional(),
  correlations: z.array(z.object({ feature: z.string(), delta: z.number() })).optional(),
  driftFindings: z.array(z.unknown()).optional(),
});

export type BrandStyleProfile = z.infer<typeof BrandStyleProfileSchema>;

export function validateProfile(profile: unknown): { ok: boolean; errors?: string[] } {
  const result = BrandStyleProfileSchema.safeParse(profile);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  // Cross-field checks
  const errors: string[] = [];
  const data = result.data;
  // text tone constraints
  if (data.text?.tone && data.text.tone.length > 10) {
    errors.push('text.tone must have at most 10 entries');
  }
  if (data.text?.tone) {
    for (const t of data.text.tone) {
      if (t.length > 32) errors.push('text.tone entries must be <= 32 chars');
    }
  }
  if (data.visual && data.visual.motifs && data.visual.motifs.length > 0) {
    if (!data.visual.palette || data.visual.palette.length === 0) {
      errors.push('visual.palette required when visual.motifs present');
    }
  }
  if (data.topics) {
    const seen = new Set<string>();
    for (const t of data.topics) {
      if (t.count <= 0) errors.push(`topics[${t.value}].count must be > 0`);
      if (seen.has(t.value)) errors.push(`topics duplicate value: ${t.value}`);
      seen.add(t.value);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
