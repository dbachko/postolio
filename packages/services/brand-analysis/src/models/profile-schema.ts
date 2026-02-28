import { z } from 'zod';

export const TextSectionSchema = z.object({
  tone: z.array(z.string()).default([]),
  styleNotes: z.array(z.string()).default([]).optional(),
});

export const InferredStyleSchema = z.object({
  emoji: z.string(),
  title: z.string(),
  description: z.string(),
});

export const VisualSectionSchema = z.object({
  palette: z.array(z.string()).default([]).optional(),
  motifs: z.array(z.string()).default([]).optional(),
  composition: z.array(z.string()).default([]).optional(),
  inferredStyles: z.array(InferredStyleSchema).default([]).optional(),
});

export const OverlaySchema = z.object({
  type: z.enum(['SEASONAL', 'TRENDING']),
  label: z.string().optional(),
  createdAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'createdAt must be ISO date')
    .optional(),
  expiresAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'expiresAt must be ISO date')
    .optional(),
  text: TextSectionSchema.partial().optional(),
  visual: VisualSectionSchema.partial().optional(),
  topics: z.array(z.object({ value: z.string(), count: z.number().int().min(1) })).optional(),
  source: z
    .object({
      reason: z.string().optional(),
      sampleSize: z.number().int().optional(),
      effectEstimate: z.number().optional(),
      method: z.string().optional(),
    })
    .optional(),
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
  overlays: z.array(OverlaySchema).optional(),
  anchors: z
    .object({
      visual: z
        .object({
          palette: z.array(z.string()).default([]).optional(),
        })
        .optional(),
    })
    .optional(),
});

export type BrandStyleProfile = z.infer<typeof BrandStyleProfileSchema>;

function collectToneValidationErrors(data: BrandStyleProfile, errors: string[]): void {
  if (data.text?.tone && data.text.tone.length > 10) {
    errors.push('text.tone must have at most 10 entries');
  }

  if (!data.text?.tone) {
    return;
  }

  for (const tone of data.text.tone) {
    if (tone.length > 32) {
      errors.push('text.tone entries must be <= 32 chars');
    }
  }
}

function collectVisualValidationErrors(data: BrandStyleProfile, errors: string[]): void {
  if (!data.visual?.motifs || data.visual.motifs.length === 0) {
    return;
  }

  if (!data.visual.palette || data.visual.palette.length === 0) {
    errors.push('visual.palette required when visual.motifs present');
  }
}

function collectTopicValidationErrors(data: BrandStyleProfile, errors: string[]): void {
  if (!data.topics) {
    return;
  }

  const seen = new Set<string>();
  for (const topic of data.topics) {
    if (topic.count <= 0) {
      errors.push(`topics[${topic.value}].count must be > 0`);
    }
    if (seen.has(topic.value)) {
      errors.push(`topics duplicate value: ${topic.value}`);
    }
    seen.add(topic.value);
  }
}

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
  collectToneValidationErrors(data, errors);
  collectVisualValidationErrors(data, errors);
  collectTopicValidationErrors(data, errors);

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
