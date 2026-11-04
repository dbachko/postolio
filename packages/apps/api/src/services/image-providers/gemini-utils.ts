function readInlineData(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as { inlineData?: unknown; inline_data?: unknown };
  const inlineData = record.inlineData ?? record.inline_data;
  if (!inlineData || typeof inlineData !== 'object') {
    return null;
  }
  const data = (inlineData as { data?: unknown }).data;
  return typeof data === 'string' ? data : null;
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
    const data = readInlineData(part);
    if (data) {
      return Buffer.from(data, 'base64');
    }
  }

  return null;
}
