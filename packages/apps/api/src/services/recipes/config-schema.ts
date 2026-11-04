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
    type: z.enum(['transform', 'skill_call', 'llm', 'content_create', 'export', 'foreach']),
    name: z.string().min(1),
    when: z.string().min(1).optional(),
  })
  .passthrough();

const TransformStepSchema = StepBaseSchema.extend({
  type: z.literal('transform'),
  // Allow arrays/objects so recipes can build structured plans (ex: post lists).
  input: z.any().optional(),
  output_key: z.string().min(1).optional(),
});

const SkillCallStepSchema = StepBaseSchema.extend({
  type: z.literal('skill_call'),
  skill: z.string().min(1),
  input: z.any().optional(),
  output_key: z.string().min(1).optional(),
});

const LlmStepSchema = StepBaseSchema.extend({
  type: z.literal('llm'),
  prompt: z.string().min(1).optional(),
  prompt_template: z.string().min(1).optional(),
  input: z.any().optional(),
  output_key: z.string().min(1).optional(),
  // Optional Structured Outputs configuration (OpenAI json_schema response_format).
  // When provided, the runner will request deterministic JSON and store the parsed object.
  structured_output: z
    .object({
      name: z.string().min(1).optional(),
      strict: z.boolean().optional(),
      schema: z.any(),
    })
    .optional(),
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

const ContentCreateStepSchema = StepBaseSchema.extend({
  type: z.literal('content_create'),
  // Expected shape (resolved at runtime): { posts|posts_json, series_name?, series_description?, start_date?, posting_time?, strategy? }
  input: z.any().optional(),
  output_key: z.string().min(1).optional(),
});

const ForeachStepBaseSchema = StepBaseSchema.extend({
  type: z.literal('foreach'),
  items: z.any(),
  item_key: z.string().min(1).optional(),
  index_key: z.string().min(1).optional(),
  output_key: z.string().min(1).optional(),
});

const InputFieldTypeSchema = z.enum([
  'input',
  'textarea',
  'select',
  'date',
  'asset_picker',
  'asset_reference_selector',
]);

const InputFieldOptionSchema = z
  .union([
    z.string().min(1),
    z.object({
      label: z.string().min(1),
      value: z.string().min(1),
    }),
  ])
  .transform((v) =>
    typeof v === 'string'
      ? {
          label: v,
          value: v,
        }
      : v
  );

const InputFieldSchema = z
  .object({
    key: z.string().min(1),
    type: InputFieldTypeSchema.default('input'),
    label: z.string().min(1).optional(),
    description: z.string().optional(),
    placeholder: z.string().optional(),
    required: z.boolean().optional().default(false),
    default: z.any().optional(),
    options: z.array(InputFieldOptionSchema).optional(),
    max: z.number().int().positive().optional(),
    multiple: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.type === 'select' && (!Array.isArray(value.options) || value.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'select input requires non-empty options',
        path: ['options'],
      });
    }
  });

const LegacyInputsSchema = z
  .object({
    required: z.array(z.string()).default([]),
    optional: z.array(z.string()).default([]),
  })
  .strict()
  .default({ required: [], optional: [] });

const TypedInputsSchema = z
  .object({
    schema: z.any().optional(),
    ui: z.array(InputFieldSchema).default([]),
  })
  .strict();

const SkillRequirementSchema = z.union([
  z.string().min(1),
  z.object({
    id: z.string().min(1),
    optional: z.boolean().optional().default(false),
    mode: z.enum(['managed', 'byok', 'either']).optional(),
  }),
]);

const CadenceSchema = z
  .object({
    count: z.number().int().positive().optional(),
    policy: z
      .enum(['once', 'use_brand_schedule', 'daily', 'weekly', 'monthly', 'custom'])
      .optional(),
    startDate: z.string().optional(),
    postingTime: z.string().optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    intervalDays: z.number().int().positive().optional(),
  })
  .passthrough();

const NonForeachStepSchema = z.discriminatedUnion('type', [
  TransformStepSchema,
  SkillCallStepSchema,
  LlmStepSchema,
  ContentCreateStepSchema,
  ExportStepSchema,
]);

type NonForeachStep = z.infer<typeof NonForeachStepSchema>;
export type RecipeStep =
  NonForeachStep | (z.infer<typeof ForeachStepBaseSchema> & { do: RecipeStep[] });

export const RecipeStepSchema: z.ZodType<RecipeStep> = z.lazy(() =>
  z.union([
    NonForeachStepSchema,
    ForeachStepBaseSchema.extend({
      do: z.array(RecipeStepSchema).min(1),
    }),
  ])
) as z.ZodType<RecipeStep>;

export const RecipeConfigSchema = z
  .object({
    inputs: z
      .union([TypedInputsSchema, LegacyInputsSchema])
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
    summary: z
      .object({
        produces: z.string().min(1).optional(),
        postsCount: z.number().int().positive().optional(),
        cadence: z.string().min(1).optional(),
      })
      .optional(),
    skills_required: z.array(SkillRequirementSchema).default([]),
    cadence: CadenceSchema.optional(),
    steps: z.array(RecipeStepSchema).min(1),
  })
  .passthrough();

export type RecipeConfig = z.infer<typeof RecipeConfigSchema>;
export type RecipeArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type RecipeInputField = z.infer<typeof InputFieldSchema>;
export type RecipeInputFieldType = z.infer<typeof InputFieldTypeSchema>;
export type RecipeInputOption = z.infer<typeof InputFieldOptionSchema>;
export type RecipeSkillRequirement = z.infer<typeof SkillRequirementSchema>;

function toHumanLabel(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) {
    return '';
  }
  const cleaned = s.replace(/[_-]+/g, ' ');
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function legacyFieldType(rawKey: string): RecipeInputFieldType {
  const key = String(rawKey || '').toLowerCase();
  if (key.includes('date')) {
    return 'date';
  }
  if (key.includes('brief') || key.includes('caption')) {
    return 'textarea';
  }
  return 'input';
}

export function normalizeInputFields(inputs: unknown): {
  fields: RecipeInputField[];
  required: string[];
  optional: string[];
} {
  const parsedTyped = TypedInputsSchema.safeParse(inputs);
  if (parsedTyped.success) {
    const fields = parsedTyped.data.ui.map((field) => ({
      ...field,
      label: field.label || toHumanLabel(field.key),
      type: field.type || 'input',
    }));
    const required = fields.filter((field) => field.required).map((field) => field.key);
    const optional = fields.filter((field) => !field.required).map((field) => field.key);
    return { fields, required, optional };
  }

  const parsedLegacy = LegacyInputsSchema.safeParse(inputs);
  if (!parsedLegacy.success) {
    return { fields: [], required: [], optional: [] };
  }

  const required = parsedLegacy.data.required;
  const optional = parsedLegacy.data.optional;
  const fields: RecipeInputField[] = [
    ...required.map((key) => ({
      key,
      type: legacyFieldType(key),
      label: toHumanLabel(key),
      required: true,
    })),
    ...optional.map((key) => ({
      key,
      type: legacyFieldType(key),
      label: toHumanLabel(key),
      required: false,
    })),
  ];
  return { fields, required, optional };
}

export function normalizeSkillRequirements(skillsRequired: unknown): Array<{
  id: string;
  optional: boolean;
  mode: 'managed' | 'byok' | 'either' | null;
}> {
  const parsed = z.array(SkillRequirementSchema).safeParse(skillsRequired);
  if (!parsed.success) {
    return [];
  }

  return parsed.data
    .map((item) => {
      if (typeof item === 'string') {
        const id = item.trim();
        if (!id) {
          return null;
        }
        return { id, optional: false, mode: null };
      }

      const id = item.id.trim();
      if (!id) {
        return null;
      }
      return {
        id,
        optional: Boolean(item.optional),
        mode: item.mode || null,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    optional: boolean;
    mode: 'managed' | 'byok' | 'either' | null;
  }>;
}
