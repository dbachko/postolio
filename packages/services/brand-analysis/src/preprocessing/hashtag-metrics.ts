export interface HashtagMetrics {
  counts: Record<string, number>;
  density: number; // hashtags per 100 words
}

export function computeHashtagMetrics(texts: string[]): HashtagMetrics {
  const counts: Record<string, number> = {};
  let totalWords = 0;
  for (const t of texts) {
    const words = t.split(/\s+/).filter(Boolean);
    totalWords += words.length;
    for (const w of words) {
      if (w.startsWith('#') && w.length > 1) {
        const k = w.toLowerCase();
        counts[k] = (counts[k] || 0) + 1;
      }
    }
  }
  const density =
    totalWords > 0 ? (Object.values(counts).reduce((a, b) => a + b, 0) / totalWords) * 100 : 0;
  return { counts, density };
}
