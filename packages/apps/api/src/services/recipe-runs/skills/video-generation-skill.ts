import { importVideoFromExternalUrl } from '../../assets-media.js';
import { resolveOpenAIForSkill, type SkillRuntimeContext } from './runtime.js';
import type { SkillExecutionResult } from './index.js';

function extractVideoUrl(response: unknown): string | null {
  const res = response as any;
  const fromData = res?.data?.[0]?.url;
  if (typeof fromData === 'string' && fromData.trim().length > 0) {
    return fromData.trim();
  }

  const fromResult = res?.result?.url;
  if (typeof fromResult === 'string' && fromResult.trim().length > 0) {
    return fromResult.trim();
  }

  const fromOutput = res?.output?.[0]?.content?.[0]?.url;
  if (typeof fromOutput === 'string' && fromOutput.trim().length > 0) {
    return fromOutput.trim();
  }

  return null;
}

export async function executeVideoGenerationSkill(
  params: SkillRuntimeContext
): Promise<SkillExecutionResult> {
  const runtime = await resolveOpenAIForSkill(params.brandId, params.skillId);
  const input = params.input && typeof params.input === 'object' ? (params.input as any) : {};

  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) {
    throw new Error('video_gen requires input.prompt');
  }

  const modelInput = typeof input.model === 'string' ? input.model.trim() : '';
  const model = modelInput || runtime.defaultModel || 'gpt-video-1';
  const sizeRaw = typeof input.size === 'string' ? input.size.trim() : '';
  const size =
    sizeRaw ||
    (typeof runtime.config.defaultSize === 'string' && runtime.config.defaultSize.trim().length > 0
      ? runtime.config.defaultSize.trim()
      : undefined);
  const durationRaw =
    typeof input.durationSeconds === 'number'
      ? input.durationSeconds
      : typeof runtime.config.defaultDurationSec === 'number'
        ? runtime.config.defaultDurationSec
        : undefined;
  const durationSeconds =
    typeof durationRaw === 'number' && Number.isFinite(durationRaw)
      ? Math.max(1, Math.floor(durationRaw))
      : undefined;

  const videosApi = (runtime.client as any).videos;
  if (!videosApi || typeof videosApi.generate !== 'function') {
    throw new Error('video_gen provider openai is not supported by the current SDK/runtime');
  }

  const response = await videosApi.generate({
    model,
    prompt,
    ...(size ? { size } : {}),
    ...(durationSeconds ? { duration: durationSeconds } : {}),
  });

  const videoUrl = extractVideoUrl(response);
  if (!videoUrl) {
    throw new Error('video_gen did not return a video URL');
  }

  const asset = await importVideoFromExternalUrl(videoUrl, {
    brandId: params.brandId,
    contentId: `recipe_${Date.now()}`,
    source: `video_gen:${runtime.provider}`,
    originalPrompt: prompt,
    hideFromLibrary: false,
  });

  return {
    output: {
      assetId: asset.id,
      url: asset.url,
      provider: runtime.provider,
      model,
      durationSeconds: durationSeconds ?? null,
      size: size ?? null,
    },
    provider: runtime.provider,
    mode: runtime.mode,
    model,
  };
}
