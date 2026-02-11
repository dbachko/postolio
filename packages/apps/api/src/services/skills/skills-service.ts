import { Prisma } from '@postolio/database';
import { prisma } from '../../config/database.js';
import { encryptSecret } from './secret-crypto.js';
import { ensureSkillDefinitionsSeeded } from './seed.js';

export async function ensureDefaultSkillInstallations(brandId: string, userId?: string) {
  await ensureSkillDefinitionsSeeded();

  const defaults: Array<{ skillDefinitionId: string; mode: 'managed' | 'byok' }> = [
    { skillDefinitionId: 'openai_text', mode: 'managed' },
    { skillDefinitionId: 'web_fetch', mode: 'managed' },
  ];

  await prisma.$transaction(
    defaults.map((d) =>
      prisma.skillInstallation.upsert({
        where: {
          brandId_skillDefinitionId: { brandId, skillDefinitionId: d.skillDefinitionId },
        },
        update: {},
        create: {
          brandId,
          skillDefinitionId: d.skillDefinitionId,
          enabled: true,
          mode: d.mode,
          configJson: {} as Prisma.InputJsonValue,
          createdByUserId: userId || null,
        },
      })
    )
  );
}

export type ListSkillsResult = Array<{
  id: string;
  name: string;
  description: string;
  icon: string | null;
  modeSupported: 'managed' | 'byok' | 'both';
  scopesJson: unknown;
  configSchemaJson: unknown;
  installation: null | {
    id: string;
    enabled: boolean;
    mode: 'managed' | 'byok';
    configJson: unknown;
    hasSecret: boolean;
  };
}>;

export async function listSkills(brandId: string): Promise<ListSkillsResult> {
  await ensureSkillDefinitionsSeeded();

  const [definitions, installations] = await Promise.all([
    prisma.skillDefinition.findMany({ orderBy: { name: 'asc' } }),
    prisma.skillInstallation.findMany({ where: { brandId } }),
  ]);

  const installationBySkillId = new Map(
    installations.map((i) => [i.skillDefinitionId, i] as const)
  );

  return definitions.map((d) => {
    const installation = installationBySkillId.get(d.id) || null;
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      icon: d.icon,
      modeSupported: d.modeSupported,
      scopesJson: d.scopesJson,
      configSchemaJson: d.configSchemaJson,
      installation: installation
        ? {
            id: installation.id,
            enabled: installation.enabled,
            mode: installation.mode,
            configJson: installation.configJson,
            hasSecret: Boolean(installation.secretId),
          }
        : null,
    };
  });
}

export type InstallSkillParams = {
  brandId: string;
  userId: string;
  skillId: string;
  mode: 'managed' | 'byok';
  config: unknown;
  secret?: { apiKey: string };
};

export async function installSkill(params: InstallSkillParams): Promise<{
  installationId: string;
  enabled: boolean;
}> {
  await ensureSkillDefinitionsSeeded();

  const definition = await prisma.skillDefinition.findUnique({
    where: { id: params.skillId },
    select: { id: true, modeSupported: true },
  });
  if (!definition) {
    throw new Error(`Unknown skill: ${params.skillId}`);
  }

  if (params.mode === 'byok' && definition.modeSupported === 'managed') {
    throw new Error(`Skill does not support BYOK mode: ${params.skillId}`);
  }

  const normalizedConfig =
    params.config && typeof params.config === 'object'
      ? params.config
      : ({} as Record<string, unknown>);
  const configJson = JSON.parse(JSON.stringify(normalizedConfig)) as Prisma.InputJsonValue;

  return await prisma.$transaction(async (tx) => {
    let secretId: string | null = null;

    if (params.mode === 'byok') {
      const apiKey = (params.secret?.apiKey || '').trim();
      if (!apiKey) {
        throw new Error('BYOK secret.apiKey is required');
      }

      const encrypted = encryptSecret(apiKey);
      const secret = await tx.encryptedSecret.create({
        data: {
          brandId: params.brandId,
          kind: 'openai_api_key',
          name: `OpenAI key for ${params.skillId}`,
          ciphertext: Uint8Array.from(encrypted.ciphertext),
          iv: Uint8Array.from(encrypted.iv),
          tag: Uint8Array.from(encrypted.tag),
          keyVersion: encrypted.keyVersion,
          createdByUserId: params.userId,
        },
        select: { id: true },
      });
      secretId = secret.id;
    }

    const existing = await tx.skillInstallation.findUnique({
      where: {
        brandId_skillDefinitionId: {
          brandId: params.brandId,
          skillDefinitionId: params.skillId,
        },
      },
      select: { id: true },
    });

    const installation = existing
      ? await tx.skillInstallation.update({
          where: { id: existing.id },
          data: {
            mode: params.mode,
            configJson,
            ...(params.mode === 'managed' ? { secretId: null } : {}),
            ...(secretId ? { secretId } : {}),
            createdByUserId: params.userId,
          },
          select: { id: true, enabled: true },
        })
      : await tx.skillInstallation.create({
          data: {
            brandId: params.brandId,
            skillDefinitionId: params.skillId,
            enabled: true,
            mode: params.mode,
            configJson,
            secretId: secretId || null,
            createdByUserId: params.userId,
          },
          select: { id: true, enabled: true },
        });

    return { installationId: installation.id, enabled: installation.enabled };
  });
}

export async function toggleSkillInstallation(params: {
  installationId: string;
  enabled: boolean;
}) {
  return await prisma.skillInstallation.update({
    where: { id: params.installationId },
    data: { enabled: params.enabled },
    select: { id: true, enabled: true },
  });
}
