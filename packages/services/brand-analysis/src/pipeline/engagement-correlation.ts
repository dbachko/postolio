export interface CorrelationFinding {
  feature: string;
  delta: number;
  direction: 'positive' | 'negative';
}

export function runEngagementCorrelationFromPosts(
  posts: Array<{
    hashtags?: string[];
    like_count?: number;
    comments_count?: number;
    media_type?: string;
  }>,
  minDelta = (() => {
    const envVal = process.env.BRAND_ANALYSIS_CORRELATION_MIN_DELTA;
    const numVal = Number(envVal);
    return envVal === undefined || Number.isNaN(numVal) ? 0.15 : numVal;
  })()
): CorrelationFinding[] {
  if (!Array.isArray(posts) || posts.length === 0) return [];

  const engagement = (p: { like_count?: number; comments_count?: number }): number =>
    (p.like_count || 0) + (p.comments_count || 0);

  const allEng = posts.map(engagement);
  const overallMean = allEng.length ? allEng.reduce((a, b) => a + b, 0) / allEng.length : 0;
  if (overallMean <= 0) return [];

  const featureDefs: Array<{ name: string; predicate: (p: (typeof posts)[number]) => boolean }> = [
    { name: 'has_hashtags', predicate: (p) => !!(p.hashtags && p.hashtags.length > 0) },
    { name: 'media_type_IMAGE', predicate: (p) => (p.media_type || '').toUpperCase() === 'IMAGE' },
    { name: 'media_type_VIDEO', predicate: (p) => (p.media_type || '').toUpperCase() === 'VIDEO' },
    {
      name: 'media_type_CAROUSEL_ALBUM',
      predicate: (p) => (p.media_type || '').toUpperCase() === 'CAROUSEL_ALBUM',
    },
  ];

  const findings: CorrelationFinding[] = [];
  for (const f of featureDefs) {
    const withFeat = posts.filter((p) => f.predicate(p)).map(engagement);
    const withoutFeat = posts.filter((p) => !f.predicate(p)).map(engagement);
    if (withFeat.length === 0 || withoutFeat.length === 0) continue;
    const meanWith = withFeat.reduce((a, b) => a + b, 0) / withFeat.length;
    const meanWithout = withoutFeat.reduce((a, b) => a + b, 0) / withoutFeat.length;
    const delta = (meanWith - meanWithout) / (overallMean || 1);
    if (Math.abs(delta) >= minDelta) {
      findings.push({ feature: f.name, delta, direction: delta >= 0 ? 'positive' : 'negative' });
    }
  }
  return findings;
}
