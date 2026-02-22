import OpenAI from 'openai';
import { prisma } from '../../../config/database.js';
import { decryptSecret } from '../../skills/secret-crypto.js';
import { getDefaultOpenAIModel, getOpenAIClient } from '../../openai-client.js';
import {
  asRecord,
  getSelectedProvider,
  getSupportedProviders,
} from '../../skills/provider-utils.js';

export type SkillRuntimeContext = {
  brandId: string;
  skillId: string;
  input: unknown;
};

export type ResolvedSkillRuntime = {
  skillId: string;
  provider: string;
  mode: 'managed' | 'byok';
  config: Record<string, unknown>;
  scopes: Record<string, unknown>;
};

export async function resolveInstalledSkillRuntime(
  brandId: string,
  skillId: string
): Promise<ResolvedSkillRuntime> {
  const [definition, installation] = await Promise.all([
    prisma.skillDefinition.findUnique({
      where: { id: skillId },
      select: { id: true, scopesJson: true },
    }),
    prisma.skillInstallation.findUnique({
      where: { brandId_skillDefinitionId: { brandId, skillDefinitionId: skillId } },
      select: { enabled: true, mode: true, configJson: true },
    }),
  ]);

  if (!definition) {
    throw new Error(`Unknown skill: ${skillId}`);
  }
  if (!installation?.enabled) {
    throw new Error(`Skill is not enabled for this brand: ${skillId}`);
  }

  const provider = getSelectedProvider({
    configJson: installation.configJson,
    scopesJson: definition.scopesJson,
  });
  if (!provider) {
    throw new Error(`No provider configured for skill: ${skillId}`);
  }

  const supportedProviders = getSupportedProviders(definition.scopesJson);
  if (supportedProviders.length > 0 && !supportedProviders.includes(provider)) {
    throw new Error(
      `Unsupported provider for ${skillId}: ${provider} (supported: ${supportedProviders.join(', ')})`
    );
  }

  return {
    skillId,
    provider,
    mode: installation.mode,
    config: asRecord(installation.configJson),
    scopes: asRecord(definition.scopesJson),
  };
}

export async function resolveOpenAIForSkill(
  brandId: string,
  skillId: string
): Promise<
  ResolvedSkillRuntime & {
    provider: 'openai';
    client: OpenAI;
    defaultModel: string;
  }
> {
  const runtime = await resolveInstalledSkillRuntime(brandId, skillId);
  if (runtime.provider !== 'openai') {
    throw new Error(
      `Provider not supported yet for ${skillId}: ${runtime.provider}. Supported: openai`
    );
  }

  const configuredModelRaw = runtime.config.defaultModel;
  const defaultModel =
    typeof configuredModelRaw === 'string' && configuredModelRaw.trim().length > 0
      ? configuredModelRaw.trim()
      : getDefaultOpenAIModel();

  if (runtime.mode === 'byok') {
    const installation = await prisma.skillInstallation.findUnique({
      where: { brandId_skillDefinitionId: { brandId, skillDefinitionId: skillId } },
      select: { secretId: true },
    });
    if (!installation?.secretId) {
      throw new Error(`${skillId} is BYOK but no secret is configured`);
    }

    const secret = await prisma.encryptedSecret.findUnique({
      where: { id: installation.secretId },
      select: { ciphertext: true, iv: true, tag: true, keyVersion: true },
    });
    if (!secret) {
      throw new Error('Configured BYOK secret was not found');
    }

    const apiKey = decryptSecret({
      ciphertext: Buffer.from(secret.ciphertext),
      iv: Buffer.from(secret.iv),
      tag: Buffer.from(secret.tag),
      keyVersion: secret.keyVersion,
    });

    return {
      ...runtime,
      provider: 'openai',
      client: new OpenAI({ apiKey }),
      defaultModel,
    };
  }

  const managedClient = getOpenAIClient();
  if (!managedClient) {
    throw new Error('OPENAI_API_KEY is not configured (managed mode unavailable)');
  }

  return {
    ...runtime,
    provider: 'openai',
    client: managedClient,
    defaultModel,
  };
}
