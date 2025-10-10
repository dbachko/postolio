export interface TextMetrics {
  avgSentenceLength: number;
  typeTokenRatio: number;
}

export function computeTextMetrics(texts: string[]): TextMetrics {
  const sentences = texts.flatMap((t) => (t.match(/[^.!?]+[.!?]+/g) || [t]).map((s) => s.trim()));
  const words = texts.flatMap((t) => tokenize(t));
  const unique = new Set(words);
  const avgSentenceLength = sentences.length > 0 ? words.length / sentences.length : 0;
  const typeTokenRatio = words.length > 0 ? unique.size / words.length : 0;
  return { avgSentenceLength, typeTokenRatio };
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[#@]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
