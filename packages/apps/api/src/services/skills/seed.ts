import { Prisma } from '@postolio/database';
import { prisma } from '../../config/database.js';

type SkillSeed = {
  id: string;
  name: string;
  description: string;
  icon?: string | null;
  modeSupported: 'managed' | 'byok' | 'both';
  scopesJson: Prisma.InputJsonValue;
  configSchemaJson: Prisma.InputJsonValue;
};

const SKILL_DEFINITIONS: SkillSeed[] = [
  {
    id: 'web_fetch',
    name: 'Web Fetch',
    description: 'Fetch a public URL and extract a safe text summary.',
    icon: null,
    modeSupported: 'managed',
    scopesJson: { network: true },
    configSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxBytes: { type: 'number', default: 1000000 },
      },
    },
  },
  {
    id: 'openai_text',
    name: 'OpenAI Text',
    description: 'LLM text generation (Managed or BYOK).',
    icon: null,
    modeSupported: 'both',
    scopesJson: { llm: true },
    configSchemaJson: {
      type: 'object',
      additionalProperties: true,
      properties: {
        defaultModel: { type: 'string' },
      },
    },
  },
];

let didSeed = false;

export async function ensureSkillDefinitionsSeeded(): Promise<void> {
  if (didSeed) return;
  didSeed = true;

  await prisma.$transaction(
    SKILL_DEFINITIONS.map((s) =>
      prisma.skillDefinition.upsert({
        where: { id: s.id },
        update: {
          name: s.name,
          description: s.description,
          icon: s.icon,
          modeSupported: s.modeSupported,
          scopesJson: s.scopesJson,
          configSchemaJson: s.configSchemaJson,
        },
        create: {
          id: s.id,
          name: s.name,
          description: s.description,
          icon: s.icon,
          modeSupported: s.modeSupported,
          scopesJson: s.scopesJson,
          configSchemaJson: s.configSchemaJson,
        },
      })
    )
  );
}
