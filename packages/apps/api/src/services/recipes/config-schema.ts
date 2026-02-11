import { z } from 'zod';

const ArtifactKindSchema = z.enum(['markdown', 'text', 'json', 'asset']);

const ArtifactSchema = z
  .object({
    kind: ArtifactKindSchema,
    name: z.string().min(1),
    mime_type: z.string().min(1).optional(),
    content: z.string().optional(),
  })
  .passthrough();

const StepBaseSchema = z
  .object({
    type: z.enum(['transform', 'skill_call', 'llm', 'export']),
    name: z.string().min(1),
    when: z.string().min(1).optional(),
  })
  .passthrough();

const TransformStepSchema = StepBaseSchema.extend({
  type: z.literal('transform'),
  input: z.record(z.string(), z.any()).optional(),
  output_key: z.string().min(1).optional(),
});

const SkillCallStepSchema = StepBaseSchema.extend({
  type: z.literal('skill_call'),
  skill: z.string().min(1),
  input: z.record(z.string(), z.any()).optional(),
  output_key: z.string().min(1).optional(),
});

const LlmStepSchema = StepBaseSchema.extend({
  type: z.literal('llm'),
  prompt: z.string().min(1).optional(),
  prompt_template: z.string().min(1).optional(),
  input: z.record(z.string(), z.any()).optional(),
  output_key: z.string().min(1).optional(),
  artifact: ArtifactSchema.optional(),
}).superRefine((val, ctx) => {
  if (!val.prompt && !val.prompt_template) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'llm step requires either prompt or prompt_template',
      path: ['prompt'],
    });
  }
});

const ExportStepSchema = StepBaseSchema.extend({
  type: z.literal('export'),
  artifacts: z.array(ArtifactSchema).min(1),
});

export const RecipeStepSchema = z.discriminatedUnion('type', [
  TransformStepSchema,
  SkillCallStepSchema,
  LlmStepSchema,
  ExportStepSchema,
]);

export const RecipeConfigSchema = z
  .object({
    inputs: z
      .object({
        required: z.array(z.string()).default([]),
        optional: z.array(z.string()).default([]),
      })
      .default({ required: [], optional: [] }),
    model_preset: z
      .object({
        provider: z.enum(['openai']).default('openai'),
        model: z.string().min(1).optional(),
        temperature: z.number().min(0).max(2).optional(),
      })
      .optional(),
    output: z
      .object({
        artifacts: z.array(ArtifactSchema).default([]),
      })
      .optional(),
    skills_required: z.array(z.string()).default([]),
    steps: z.array(RecipeStepSchema).min(1),
  })
  .passthrough();

export type RecipeConfig = z.infer<typeof RecipeConfigSchema>;
export type RecipeStep = z.infer<typeof RecipeStepSchema>;
export type RecipeArtifactKind = z.infer<typeof ArtifactKindSchema>;
