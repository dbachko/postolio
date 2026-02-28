import type { Prisma } from '@postolio/database';

export type SkillSeed = {
  id: string;
  name: string;
  description: string;
  icon?: string | null;
  modeSupported: 'managed' | 'byok' | 'both';
  scopesJson: Prisma.InputJsonValue;
  configSchemaJson: Prisma.InputJsonValue;
};
