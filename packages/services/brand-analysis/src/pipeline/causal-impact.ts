export type CausalImpactInput = {
  series: number[]; // observed metric time series
  interventionIndex: number; // index at which intervention starts
  controls?: number[][]; // optional control series
};

export type CausalImpactResult = {
  method: 'naive' | 'remote';
  effectEstimate: number; // relative change post vs pre (normalized by pre mean)
  pValue?: number;
  details?: unknown;
};

function naiveEffect(series: number[], idx: number): CausalImpactResult {
  const pre = series.slice(0, Math.max(1, idx));
  const post = series.slice(idx);
  const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const mPre = mean(pre);
  const mPost = mean(post);
  const effect = mPre !== 0 ? (mPost - mPre) / Math.abs(mPre) : 0;
  return { method: 'naive', effectEstimate: effect };
}

export async function estimateCausalImpact(input: CausalImpactInput): Promise<CausalImpactResult> {
  const url = process.env.CAUSAL_IMPACT_URL;
  if (!url) return naiveEffect(input.series, input.interventionIndex);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    } as RequestInit);
    if (!resp.ok) return naiveEffect(input.series, input.interventionIndex);
    const json = (await resp.json()) as Partial<CausalImpactResult>;
    if (typeof json?.effectEstimate !== 'number')
      return naiveEffect(input.series, input.interventionIndex);
    return {
      method: 'remote',
      effectEstimate: json.effectEstimate,
      pValue: json.pValue,
      details: json.details,
    };
  } catch {
    return naiveEffect(input.series, input.interventionIndex);
  }
}
