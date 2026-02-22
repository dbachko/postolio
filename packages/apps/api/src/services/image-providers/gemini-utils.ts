type InlineDataPart = { inlineData: { data: string } };

function isInlineDataPart(value: unknown): value is InlineDataPart {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (!('inlineData' in value)) {
    return false;
  }
  const inlineData = (value as { inlineData?: unknown }).inlineData;
  if (!inlineData || typeof inlineData !== 'object') {
    return false;
  }
  return typeof (inlineData as { data?: unknown }).data === 'string';
}

type GeminiResponseLike = {
  candidates?: Array<{
    content?: {
      parts?: unknown[];
    };
  }>;
};

/**
 * Best-effort extraction of a base64 inline image from the Google Generative AI response.
 * Returns null if no inline image part is found.
 */
export function extractInlineImageBuffer(response: unknown): Buffer | null {
  const candidates = (response as GeminiResponseLike | null | undefined)?.candidates;
  const parts = candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return null;
  }

  for (const part of parts) {
    if (isInlineDataPart(part)) {
      return Buffer.from(part.inlineData.data, 'base64');
    }
  }

  return null;
}
