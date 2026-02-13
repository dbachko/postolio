import { describe, expect, it } from 'vitest';

import {
  RecipeConfigSchema,
  normalizeInputFields,
  normalizeSkillRequirements,
} from '../config-schema.js';

describe('recipe config schema', () => {
  it('parses typed inputs, structured skill requirements, cadence, and foreach steps', () => {
    const parsed = RecipeConfigSchema.parse({
      inputs: {
        schema: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
            tone: { type: 'string' },
          },
          required: ['topic'],
        },
        ui: [
          { key: 'topic', type: 'textarea', required: true },
          {
            key: 'tone',
            type: 'select',
            options: ['Friendly', 'Bold'],
            required: false,
          },
        ],
      },
      skills_required: [{ id: 'text_generation' }, { id: 'image_generation', optional: true }],
      cadence: { count: 7, policy: 'daily', postingTime: '09:00' },
      steps: [
        {
          type: 'foreach',
          name: 'Generate per pillar',
          items: '{{input.pillars}}',
          item_key: 'pillar',
          do: [
            {
              type: 'transform',
              name: 'Prepare prompt',
              output_key: 'prompt',
              input: { text: 'Write about {{pillar}}' },
            },
          ],
        },
      ],
    });

    expect(parsed.steps[0].type).toBe('foreach');
    expect((parsed.steps[0] as any).do).toHaveLength(1);
    expect(parsed.cadence).toMatchObject({ count: 7, policy: 'daily' });
  });

  it('normalizes typed input fields', () => {
    const normalized = normalizeInputFields({
      ui: [
        { key: 'topic', type: 'textarea', required: true },
        { key: 'tone', type: 'input', required: false },
      ],
    });

    expect(normalized.required).toEqual(['topic']);
    expect(normalized.optional).toEqual(['tone']);
    expect(normalized.fields.map((f) => f.key)).toEqual(['topic', 'tone']);
  });

  it('normalizes legacy required/optional input arrays', () => {
    const normalized = normalizeInputFields({
      required: ['topic'],
      optional: ['brand_voice'],
    });

    expect(normalized.required).toEqual(['topic']);
    expect(normalized.optional).toEqual(['brand_voice']);
    expect(normalized.fields[0]?.required).toBe(true);
    expect(normalized.fields[1]?.required).toBe(false);
  });

  it('normalizes skill requirements from strings and objects', () => {
    const normalized = normalizeSkillRequirements([
      'text_generation',
      { id: 'image_generation', optional: true, mode: 'byok' },
    ]);

    expect(normalized).toEqual([
      { id: 'text_generation', optional: false, mode: null },
      { id: 'image_generation', optional: true, mode: 'byok' },
    ]);
  });
});
