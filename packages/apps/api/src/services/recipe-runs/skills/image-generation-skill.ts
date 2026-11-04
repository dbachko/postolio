import { importImageBuffer } from '../../assets-media.js';
import { generateOpenAIImage, OPENAI_IMAGE_MODEL } from '../../image-providers/openai-image.js';
import { resolveOpenAIForSkill, type SkillRuntimeContext } from './runtime.js';
import type { SkillExecutionResult } from './index.js';

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

  const sizeRaw = typeof input.size === 'string' ? input.size : runtime.config.defaultSize;
  const qualityRaw =
    typeof input.quality === 'string' ? input.quality : runtime.config.defaultQuality;
  const requestedSize =
    typeof sizeRaw === 'string' && sizeRaw.trim().length > 0 ? sizeRaw.trim() : '1024x1024';
  const qualityInput =
    typeof qualityRaw === 'string' && qualityRaw.trim().length > 0 ? qualityRaw : 'auto';

  const { imageBuffer, size, quality } = await generateOpenAIImage(runtime.client, {
    prompt,
    size: requestedSize,
    quality: normalizeImageQuality(qualityInput),
  });

  const asset = await importImageBuffer(imageBuffer, {
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
      model: OPENAI_IMAGE_MODEL,
      size,
      quality,
    },
    provider: runtime.provider,
    mode: runtime.mode,
    model: OPENAI_IMAGE_MODEL,
  };
}
