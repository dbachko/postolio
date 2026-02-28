import type { Prisma } from '@postolio/database';
import { prisma } from '../../config/database.js';
import { encryptSecret } from './secret-crypto.js';
import { ensureSkillDefinitionsSeeded } from './seed.js';
import { installSkillInternal } from './install-skill.js';
import { getSelectedProvider, getSupportedProviders } from './provider-utils.js';
import { trySkillInternal } from './try-skill.js';

async function upsertProviderSecret(params: {
  tx: Prisma.TransactionClient;
  brandId: string;
  userId: string;
  provider: string;
  apiKey: string;
}): Promise<string> {
  const encrypted = encryptSecret(params.apiKey);
  const secretName = `provider:${params.provider}`;
  const secret = await params.tx.encryptedSecret.upsert({
    where: {
      brandId_kind_name: {
        brandId: params.brandId,
        kind: 'provider_api_key',
        name: secretName,
      },
    },
    update: {
      ciphertext: Uint8Array.from(encrypted.ciphertext),
      iv: Uint8Array.from(encrypted.iv),
      tag: Uint8Array.from(encrypted.tag),
      keyVersion: encrypted.keyVersion,
      rotatedAt: new Date(),
    },
    create: {
      brandId: params.brandId,
      kind: 'provider_api_key',
      name: secretName,
      ciphertext: Uint8Array.from(encrypted.ciphertext),
      iv: Uint8Array.from(encrypted.iv),
      tag: Uint8Array.from(encrypted.tag),
      keyVersion: encrypted.keyVersion,
      createdByUserId: params.userId,
    },
    select: { id: true },
  });

  return secret.id;
}

export async function ensureDefaultSkillInstallations(brandId: string, userId?: string) {
  await ensureSkillDefinitionsSeeded();

  const defaults: Array<{ skillDefinitionId: string; mode: 'managed' | 'byok' }> = [
    { skillDefinitionId: 'text_generation', mode: 'managed' },
    { skillDefinitionId: 'image_generation', mode: 'managed' },
    { skillDefinitionId: 'web_fetch', mode: 'managed' },
  ];

  // Bootstrap defaults once for brands that have no installations yet.
  // This avoids silently re-creating user-uninstalled skills on every list request.
  const existingCount = await prisma.skillInstallation.count({ where: { brandId } });
  if (existingCount > 0) {
    return;
  }

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
  provider: string | null;
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
      provider: getSelectedProvider({
        configJson: installation?.configJson,
        scopesJson: d.scopesJson,
      }),
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
  return installSkillInternal(params, {
    prisma,
    ensureSkillDefinitionsSeeded,
    getSelectedProvider,
    getSupportedProviders,
    upsertProviderSecret,
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

export async function getSkill(
  brandId: string,
  skillId: string
): Promise<ListSkillsResult[number] | null> {
  await ensureSkillDefinitionsSeeded();

  const [definition, installation] = await Promise.all([
    prisma.skillDefinition.findUnique({ where: { id: skillId } }),
    prisma.skillInstallation.findUnique({
      where: { brandId_skillDefinitionId: { brandId, skillDefinitionId: skillId } },
    }),
  ]);

  if (!definition) {
    return null;
  }

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    icon: definition.icon,
    provider: getSelectedProvider({
      configJson: installation?.configJson,
      scopesJson: definition.scopesJson,
    }),
    modeSupported: definition.modeSupported,
    scopesJson: definition.scopesJson,
    configSchemaJson: definition.configSchemaJson,
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
}

async function cleanupUnusedSecret(secretId: string, tx: Prisma.TransactionClient): Promise<void> {
  const stillUsed = await tx.skillInstallation.count({ where: { secretId } });
  if (stillUsed > 0) {
    return;
  }
  await tx.encryptedSecret.deleteMany({ where: { id: secretId } });
}

export async function uninstallSkillBySkillId(params: {
  brandId: string;
  skillId: string;
}): Promise<{ uninstalled: boolean }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.skillInstallation.findUnique({
      where: {
        brandId_skillDefinitionId: { brandId: params.brandId, skillDefinitionId: params.skillId },
      },
      select: { id: true, secretId: true },
    });
    if (!existing) {
      return { uninstalled: false };
    }

    await tx.skillInstallation.delete({ where: { id: existing.id } });
    if (existing.secretId) {
      await cleanupUnusedSecret(existing.secretId, tx);
    }
    return { uninstalled: true };
  });
}

export async function uninstallSkillByInstallationId(params: {
  installationId: string;
}): Promise<{ uninstalled: boolean }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.skillInstallation.findUnique({
      where: { id: params.installationId },
      select: { id: true, secretId: true },
    });
    if (!existing) {
      return { uninstalled: false };
    }

    await tx.skillInstallation.delete({ where: { id: existing.id } });
    if (existing.secretId) {
      await cleanupUnusedSecret(existing.secretId, tx);
    }
    return { uninstalled: true };
  });
}

export async function trySkill(params: {
  brandId: string;
  skillId: string;
  input?: unknown;
}): Promise<{ ok: true; output: unknown; note: string }> {
  return trySkillInternal(params, {
    prisma,
    ensureSkillDefinitionsSeeded,
    getSelectedProvider,
  });
}
