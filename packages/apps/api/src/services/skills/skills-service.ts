import type { Prisma } from '@postolio/database';
import { prisma } from '../../config/database.js';
import { encryptSecret } from './secret-crypto.js';
import { ensureSkillDefinitionsSeeded } from './seed.js';
import {
  asRecord,
  getSelectedProvider,
  getSupportedProviders,
  normalizeProvider,
} from './provider-utils.js';

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
  await ensureSkillDefinitionsSeeded();

  const definition = await prisma.skillDefinition.findUnique({
    where: { id: params.skillId },
    select: { id: true, modeSupported: true, scopesJson: true },
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
  const selectedProvider = getSelectedProvider({
    configJson: normalizedConfig,
    scopesJson: definition.scopesJson,
  });
  const supportedProviders = getSupportedProviders(definition.scopesJson);
  if (!selectedProvider) {
    throw new Error(`No provider configured for skill: ${params.skillId}`);
  }
  if (supportedProviders.length > 0 && !supportedProviders.includes(selectedProvider)) {
    throw new Error(
      `Unsupported provider for ${params.skillId}: ${selectedProvider} (supported: ${supportedProviders.join(', ')})`
    );
  }

  const configWithProvider =
    typeof normalizedConfig === 'object' && normalizedConfig
      ? { ...(normalizedConfig as Record<string, unknown>), provider: selectedProvider }
      : ({ provider: selectedProvider } as Record<string, unknown>);
  const configJson = JSON.parse(JSON.stringify(configWithProvider)) as Prisma.InputJsonValue;

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.skillInstallation.findUnique({
      where: {
        brandId_skillDefinitionId: {
          brandId: params.brandId,
          skillDefinitionId: params.skillId,
        },
      },
      select: { id: true },
    });

    let secretId: string | null = null;
    if (params.mode === 'byok') {
      const apiKey = (params.secret?.apiKey || '').trim();
      if (apiKey) {
        secretId = await upsertProviderSecret({
          tx,
          brandId: params.brandId,
          userId: params.userId,
          provider: selectedProvider,
          apiKey,
        });
      } else {
        const providerSecretName = `provider:${selectedProvider}`;
        const existingProviderSecret = await tx.encryptedSecret.findUnique({
          where: {
            brandId_kind_name: {
              brandId: params.brandId,
              kind: 'provider_api_key',
              name: providerSecretName,
            },
          },
          select: { id: true },
        });

        if (existingProviderSecret) {
          secretId = existingProviderSecret.id;
        } else if (existing) {
          const prev = await tx.skillInstallation.findUnique({
            where: { id: existing.id },
            select: { secretId: true },
          });
          if (prev?.secretId) {
            secretId = prev.secretId;
          } else {
            throw new Error(`BYOK secret.apiKey is required for provider: ${selectedProvider}`);
          }
        } else {
          throw new Error(`BYOK secret.apiKey is required for provider: ${selectedProvider}`);
        }
      }
    }

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
  await ensureSkillDefinitionsSeeded();

  const [definition, installation] = await Promise.all([
    prisma.skillDefinition.findUnique({
      where: { id: params.skillId },
      select: { id: true, scopesJson: true },
    }),
    prisma.skillInstallation.findUnique({
      where: {
        brandId_skillDefinitionId: { brandId: params.brandId, skillDefinitionId: params.skillId },
      },
      select: { enabled: true, configJson: true },
    }),
  ]);

  if (!definition) {
    throw new Error(`Unknown skill: ${params.skillId}`);
  }

  if (!installation?.enabled) {
    throw new Error(`Skill is not enabled for this brand: ${params.skillId}`);
  }

  const input = params.input && typeof params.input === 'object' ? (params.input as any) : {};
  const selectedProvider = getSelectedProvider({
    configJson: installation?.configJson,
    scopesJson: definition.scopesJson,
  });

  switch (params.skillId) {
    case 'text_generation': {
      const prompt =
        typeof input.prompt === 'string' && input.prompt.trim().length > 0
          ? input.prompt.trim()
          : 'Write one social post idea for a product launch.';
      return {
        ok: true,
        output: {
          provider: selectedProvider || 'openai',
          preview: `Stub output for prompt: ${prompt.slice(0, 120)}`,
        },
        note: 'Safe stub response (no external model call).',
      };
    }
    case 'image_generation': {
      const prompt =
        typeof input.prompt === 'string' && input.prompt.trim().length > 0
          ? input.prompt.trim()
          : 'A clean product hero shot on a bright background.';
      return {
        ok: true,
        output: {
          provider: selectedProvider || 'openai',
          model: 'dall-e-3',
          prompt,
          imageUrl: null,
        },
        note: 'Safe stub response (no image generation performed).',
      };
    }
    case 'video_gen': {
      const prompt =
        typeof input.prompt === 'string' && input.prompt.trim().length > 0
          ? input.prompt.trim()
          : 'A cinematic product reveal clip.';
      return {
        ok: true,
        output: {
          provider: selectedProvider || 'openai',
          model: 'gpt-video-1',
          prompt,
          videoUrl: null,
        },
        note: 'Safe stub response (no video generation performed).',
      };
    }
    case 'audio_gen': {
      const text =
        typeof input.text === 'string' && input.text.trim().length > 0
          ? input.text.trim()
          : typeof input.prompt === 'string' && input.prompt.trim().length > 0
            ? input.prompt.trim()
            : 'Welcome to your weekly content update.';
      return {
        ok: true,
        output: {
          provider: selectedProvider || 'openai',
          model: 'gpt-4o-mini-tts',
          text,
          audioBase64: null,
        },
        note: 'Safe stub response (no audio generation performed).',
      };
    }
    case 'web_fetch': {
      const url =
        typeof input.url === 'string' && input.url.trim().length > 0
          ? input.url.trim()
          : 'https://example.com';
      return {
        ok: true,
        output: {
          url,
          text: 'Stub fetch result: this endpoint is wired and ready for safe demo usage.',
        },
        note: 'Safe stub response (no network fetch performed).',
      };
    }
    default:
      return {
        ok: true,
        output: {
          skillId: params.skillId,
          accepted: true,
        },
        note: 'Safe stub response.',
      };
  }
}
