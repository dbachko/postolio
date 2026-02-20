import { importImageFromExternalUrl } from '../../assets-media.js';
import { resolveOpenAIForSkill, type SkillRuntimeContext } from './runtime.js';
import type { SkillExecutionResult } from './index.js';

type ImageSize = '1024x1024' | '1792x1024' | '1024x1792';
type ImageQuality = 'low' | 'medium' | 'high' | 'auto';

function normalizeImageQuality(rawQuality: string): ImageQuality {
  const normalizedQuality = rawQuality.trim().toLowerCase();
  if (
    normalizedQuality === 'low' ||
    normalizedQuality === 'medium' ||
    normalizedQuality === 'high' ||
    normalizedQuality === 'auto'
  ) {
    return normalizedQuality;
  }
  throw new Error(
    `Invalid image quality '${rawQuality}'. Supported values: low, medium, high, auto.`
  );
}

export async function executeImageGenerationSkill(
  params: SkillRuntimeContext
): Promise<SkillExecutionResult> {
  const runtime = await resolveOpenAIForSkill(params.brandId, params.skillId);
  const input = params.input && typeof params.input === 'object' ? (params.input as any) : {};

  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) {
    throw new Error('image_generation requires input.prompt');
  }

  const model = 'gpt-image-1';

  const sizeRaw = typeof input.size === 'string' ? input.size : runtime.config.defaultSize;
  const qualityRaw =
    typeof input.quality === 'string' ? input.quality : runtime.config.defaultQuality;
  const size = (
    typeof sizeRaw === 'string' && sizeRaw.trim().length > 0 ? sizeRaw.trim() : '1024x1024'
  ) as ImageSize;
  const qualityInput =
    typeof qualityRaw === 'string' && qualityRaw.trim().length > 0 ? qualityRaw : 'auto';
  const quality = normalizeImageQuality(qualityInput);

  const response = await runtime.client.images.generate({
    model,
    prompt,
    size,
    quality,
    n: 1,
  });

  const first = (response as any)?.data?.[0];
  const imageUrl = first?.url as string | undefined;
  if (!imageUrl) {
    throw new Error('image_generation did not return an image URL');
  }

  const asset = await importImageFromExternalUrl(imageUrl, {
    brandId: params.brandId,
    contentId: `recipe_${Date.now()}`,
    source: `image_generation:${runtime.provider}`,
    originalPrompt: prompt,
  });

  return {
    output: {
      assetId: asset.id,
      url: asset.url,
      provider: runtime.provider,
      model,
      revisedPrompt: first?.revised_prompt ?? null,
      size,
      quality,
    },
    provider: runtime.provider,
    mode: runtime.mode,
    model,
  };
}
