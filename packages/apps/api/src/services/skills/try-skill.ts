import type { Prisma } from '@postolio/database';

type TrySkillParams = {
  brandId: string;
  skillId: string;
  input?: unknown;
};

type TrySkillDependencies = {
  prisma: any;
  ensureSkillDefinitionsSeeded: () => Promise<void>;
  getSelectedProvider: (params: { configJson: unknown; scopesJson: unknown }) => string | null;
};

type TrySkillResult = { ok: true; output: unknown; note: string };

function toInputRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object') {
    return input as Record<string, unknown>;
  }
  return {};
}

function resolvePrompt(input: Record<string, unknown>, fallback: string): string {
  const prompt = input.prompt;
  if (typeof prompt === 'string' && prompt.trim().length > 0) {
    return prompt.trim();
  }
  return fallback;
}

function resolveAudioText(input: Record<string, unknown>): string {
  const text = input.text;
  if (typeof text === 'string' && text.trim().length > 0) {
    return text.trim();
  }

  const prompt = input.prompt;
  if (typeof prompt === 'string' && prompt.trim().length > 0) {
    return prompt.trim();
  }

  return 'Welcome to your weekly content update.';
}

function buildTextGenerationOutput(
  input: Record<string, unknown>,
  provider: string
): TrySkillResult {
  const prompt = resolvePrompt(input, 'Write one social post idea for a product launch.');
  return {
    ok: true,
    output: {
      provider,
      preview: `Stub output for prompt: ${prompt.slice(0, 120)}`,
    },
    note: 'Safe stub response (no external model call).',
  };
}

function buildImageGenerationOutput(
  input: Record<string, unknown>,
  provider: string
): TrySkillResult {
  const prompt = resolvePrompt(input, 'A clean product hero shot on a bright background.');
  return {
    ok: true,
    output: {
      provider,
      model: 'gpt-image-2',
      prompt,
      imageUrl: null,
    },
    note: 'Safe stub response (no image generation performed).',
  };
}

function buildVideoGenerationOutput(
  input: Record<string, unknown>,
  provider: string
): TrySkillResult {
  const prompt = resolvePrompt(input, 'A cinematic product reveal clip.');
  return {
    ok: true,
    output: {
      provider,
      model: 'gpt-video-1',
      prompt,
      videoUrl: null,
    },
    note: 'Safe stub response (no video generation performed).',
  };
}

function buildAudioGenerationOutput(
  input: Record<string, unknown>,
  provider: string
): TrySkillResult {
  return {
    ok: true,
    output: {
      provider,
      model: 'gpt-4o-mini-tts',
      text: resolveAudioText(input),
      audioBase64: null,
    },
    note: 'Safe stub response (no audio generation performed).',
  };
}

function buildWebFetchOutput(input: Record<string, unknown>): TrySkillResult {
  const urlValue = input.url;
  const url =
    typeof urlValue === 'string' && urlValue.trim().length > 0
      ? urlValue.trim()
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

function buildDefaultOutput(skillId: string): TrySkillResult {
  return {
    ok: true,
    output: {
      skillId,
      accepted: true,
    },
    note: 'Safe stub response.',
  };
}

function buildSkillOutput(
  skillId: string,
  input: Record<string, unknown>,
  selectedProvider: string
): TrySkillResult {
  switch (skillId) {
    case 'text_generation':
      return buildTextGenerationOutput(input, selectedProvider);
    case 'image_generation':
      return buildImageGenerationOutput(input, selectedProvider);
    case 'video_gen':
      return buildVideoGenerationOutput(input, selectedProvider);
    case 'audio_gen':
      return buildAudioGenerationOutput(input, selectedProvider);
    case 'web_fetch':
      return buildWebFetchOutput(input);
    default:
      return buildDefaultOutput(skillId);
  }
}

async function loadTrySkillContext(
  params: TrySkillParams,
  deps: TrySkillDependencies
): Promise<{
  definition: { id: string; scopesJson: unknown };
  installation: { enabled: boolean; configJson: Prisma.JsonValue };
}> {
  const [definition, installation] = await Promise.all([
    deps.prisma.skillDefinition.findUnique({
      where: { id: params.skillId },
      select: { id: true, scopesJson: true },
    }),
    deps.prisma.skillInstallation.findUnique({
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

  return {
    definition,
    installation,
  };
}

export async function trySkillInternal(
  params: TrySkillParams,
  deps: TrySkillDependencies
): Promise<TrySkillResult> {
  await deps.ensureSkillDefinitionsSeeded();

  const { definition, installation } = await loadTrySkillContext(params, deps);
  const input = toInputRecord(params.input);
  const selectedProvider =
    deps.getSelectedProvider({
      configJson: installation.configJson,
      scopesJson: definition.scopesJson,
    }) || 'openai';

  return buildSkillOutput(params.skillId, input, selectedProvider);
}
