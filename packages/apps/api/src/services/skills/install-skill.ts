import type { Prisma } from '@postolio/database';
import type { InstallSkillParams } from './skills-service.js';

type InstallSkillDependencies = {
  prisma: any;
  ensureSkillDefinitionsSeeded: () => Promise<void>;
  getSelectedProvider: (params: { configJson: unknown; scopesJson: unknown }) => string | null;
  getSupportedProviders: (scopesJson: unknown) => string[];
  upsertProviderSecret: (params: {
    tx: Prisma.TransactionClient;
    brandId: string;
    userId: string;
    provider: string;
    apiKey: string;
  }) => Promise<string>;
};

function normalizeConfig(config: unknown): Record<string, unknown> {
  if (config && typeof config === 'object') {
    return config as Record<string, unknown>;
  }
  return {};
}

function resolveSelectedProvider(
  params: InstallSkillParams,
  definition: { scopesJson: unknown },
  deps: InstallSkillDependencies
): string {
  const normalizedConfig = normalizeConfig(params.config);
  const selectedProvider = deps.getSelectedProvider({
    configJson: normalizedConfig,
    scopesJson: definition.scopesJson,
  });
  const supportedProviders = deps.getSupportedProviders(definition.scopesJson);

  if (!selectedProvider) {
    throw new Error(`No provider configured for skill: ${params.skillId}`);
  }
  if (supportedProviders.length > 0 && !supportedProviders.includes(selectedProvider)) {
    throw new Error(
      `Unsupported provider for ${params.skillId}: ${selectedProvider} (supported: ${supportedProviders.join(', ')})`
    );
  }

  return selectedProvider;
}

function buildConfigJson(config: unknown, provider: string): Prisma.InputJsonValue {
  const normalizedConfig = normalizeConfig(config);
  const configWithProvider = {
    ...normalizedConfig,
    provider,
  };
  return JSON.parse(JSON.stringify(configWithProvider)) as Prisma.InputJsonValue;
}

async function resolveSecretId(params: {
  tx: Prisma.TransactionClient;
  install: InstallSkillParams;
  existing: { id: string } | null;
  selectedProvider: string;
  deps: InstallSkillDependencies;
}): Promise<string | null> {
  if (params.install.mode !== 'byok') {
    return null;
  }

  const apiKey = (params.install.secret?.apiKey || '').trim();
  if (apiKey) {
    return params.deps.upsertProviderSecret({
      tx: params.tx,
      brandId: params.install.brandId,
      userId: params.install.userId,
      provider: params.selectedProvider,
      apiKey,
    });
  }

  const providerSecretName = `provider:${params.selectedProvider}`;
  const existingProviderSecret = await params.tx.encryptedSecret.findUnique({
    where: {
      brandId_kind_name: {
        brandId: params.install.brandId,
        kind: 'provider_api_key',
        name: providerSecretName,
      },
    },
    select: { id: true },
  });

  if (existingProviderSecret) {
    return existingProviderSecret.id;
  }
  if (!params.existing) {
    throw new Error(`BYOK secret.apiKey is required for provider: ${params.selectedProvider}`);
  }

  const previous = await params.tx.skillInstallation.findUnique({
    where: { id: params.existing.id },
    select: { secretId: true },
  });
  if (previous?.secretId) {
    return previous.secretId;
  }

  throw new Error(`BYOK secret.apiKey is required for provider: ${params.selectedProvider}`);
}

async function upsertInstallation(params: {
  tx: Prisma.TransactionClient;
  install: InstallSkillParams;
  existing: { id: string } | null;
  configJson: Prisma.InputJsonValue;
  secretId: string | null;
}): Promise<{ installationId: string; enabled: boolean }> {
  const installation = params.existing
    ? await params.tx.skillInstallation.update({
        where: { id: params.existing.id },
        data: {
          mode: params.install.mode,
          configJson: params.configJson,
          ...(params.install.mode === 'managed' ? { secretId: null } : {}),
          ...(params.secretId ? { secretId: params.secretId } : {}),
          createdByUserId: params.install.userId,
        },
        select: { id: true, enabled: true },
      })
    : await params.tx.skillInstallation.create({
        data: {
          brandId: params.install.brandId,
          skillDefinitionId: params.install.skillId,
          enabled: true,
          mode: params.install.mode,
          configJson: params.configJson,
          secretId: params.secretId,
          createdByUserId: params.install.userId,
        },
        select: { id: true, enabled: true },
      });

  return {
    installationId: installation.id,
    enabled: installation.enabled,
  };
}

export async function installSkillInternal(
  params: InstallSkillParams,
  deps: InstallSkillDependencies
): Promise<{ installationId: string; enabled: boolean }> {
  await deps.ensureSkillDefinitionsSeeded();

  const definition = await deps.prisma.skillDefinition.findUnique({
    where: { id: params.skillId },
    select: { id: true, modeSupported: true, scopesJson: true },
  });
  if (!definition) {
    throw new Error(`Unknown skill: ${params.skillId}`);
  }
  if (params.mode === 'byok' && definition.modeSupported === 'managed') {
    throw new Error(`Skill does not support BYOK mode: ${params.skillId}`);
  }

  const selectedProvider = resolveSelectedProvider(params, definition, deps);
  const configJson = buildConfigJson(params.config, selectedProvider);

  return deps.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.skillInstallation.findUnique({
      where: {
        brandId_skillDefinitionId: {
          brandId: params.brandId,
          skillDefinitionId: params.skillId,
        },
      },
      select: { id: true },
    });

    const secretId = await resolveSecretId({
      tx,
      install: params,
      existing,
      selectedProvider,
      deps,
    });

    return upsertInstallation({
      tx,
      install: params,
      existing,
      configJson,
      secretId,
    });
  });
}
