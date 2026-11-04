import type OpenAI from 'openai';

export const OPENAI_IMAGE_MODEL = 'gpt-image-2';

type OpenAIImageSize = '1024x1024' | '1536x1024' | '1024x1536';
type OpenAIImageQuality = 'auto' | 'low' | 'medium' | 'high';

// Configs saved for DALL-E 3 still hold these values.
const LEGACY_SIZES: Record<string, OpenAIImageSize> = {
  '1792x1024': '1536x1024',
  '1024x1792': '1024x1536',
};
const LEGACY_QUALITIES: Record<string, OpenAIImageQuality> = {
  standard: 'medium',
  hd: 'high',
};

export function toOpenAIImageSize(size: string): OpenAIImageSize {
  return LEGACY_SIZES[size] ?? (size as OpenAIImageSize);
}

export function toOpenAIImageQuality(quality: string): OpenAIImageQuality {
  return LEGACY_QUALITIES[quality] ?? (quality as OpenAIImageQuality);
}

// OpenAI publishes per-token prices only (USD per 1M tokens).
const TEXT_INPUT_PRICE = 5;
const IMAGE_INPUT_PRICE = 8;
const IMAGE_OUTPUT_PRICE = 30;

type OpenAIImageUsage = {
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  output_tokens?: number;
};

export function calculateOpenAIImageCost(usage: OpenAIImageUsage | undefined): number | undefined {
  if (usage?.output_tokens === undefined) {
    return undefined;
  }
  const { text_tokens = 0, image_tokens = 0 } = usage.input_tokens_details ?? {};
  return (
    (text_tokens * TEXT_INPUT_PRICE +
      image_tokens * IMAGE_INPUT_PRICE +
      usage.output_tokens * IMAGE_OUTPUT_PRICE) /
    1_000_000
  );
}

/** GPT image models always answer with base64 data; they never return a URL. */
export async function generateOpenAIImage(
  client: OpenAI,
  params: { prompt: string; size: string; quality: string }
): Promise<{
  imageBuffer: Buffer;
  size: OpenAIImageSize;
  quality: OpenAIImageQuality;
  cost: number | undefined;
}> {
  const size = toOpenAIImageSize(params.size);
  const quality = toOpenAIImageQuality(params.quality);
  const response = await client.images.generate({
    model: OPENAI_IMAGE_MODEL,
    prompt: params.prompt,
    size,
    quality,
    n: 1,
  });

  const data = response.data?.[0]?.b64_json;
  if (!data) {
    throw new Error(`No image data received from ${OPENAI_IMAGE_MODEL}`);
  }
  return {
    imageBuffer: Buffer.from(data, 'base64'),
    size,
    quality,
    cost: calculateOpenAIImageCost(response.usage),
  };
}
