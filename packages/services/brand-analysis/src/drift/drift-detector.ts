export interface DriftFinding {
  field: string;
  summary: string;
}

export function jaccard<A extends string | number>(a: A[], b: A[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = new Set([...sa].filter((x) => sb.has(x))).size;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 1 : inter / union;
}

export function detectDrift(prev: unknown, next: unknown): DriftFinding[] {
  const p = prev as Record<string, unknown> | undefined;
  const n = next as Record<string, unknown> | undefined;
  const findings: DriftFinding[] = [];
  const toneThreshold = Number(process.env.BRAND_ANALYSIS_DRIFT_TONE_THRESHOLD || 0.15);
  const paletteThreshold = Number(process.env.BRAND_ANALYSIS_DRIFT_PALETTE_JACCARD || 0.6);

  const asStringArray = (x: unknown): string[] =>
    Array.isArray(x) ? (x.filter((v) => typeof v === 'string') as string[]) : [];
  const pVisual = (p?.visual as Record<string, unknown> | undefined) || undefined;
  const nVisual = (n?.visual as Record<string, unknown> | undefined) || undefined;
  const prevPalette = asStringArray(pVisual?.palette);
  const nextPalette = asStringArray(nVisual?.palette);
  const j = jaccard(prevPalette, nextPalette);
  if (j < paletteThreshold) {
    findings.push({
      field: 'visual.palette',
      summary: `Palette similarity low (J=${j.toFixed(2)})`,
    });
  }

  // Placeholder: tone drift could be computed via numeric vector; here we only note change count
  const pText = (p?.text as Record<string, unknown> | undefined) || undefined;
  const nText = (n?.text as Record<string, unknown> | undefined) || undefined;
  const prevTones = new Set<string>(asStringArray(pText?.tone));
  const nextTones = new Set<string>(asStringArray(nText?.tone));
  const added = [...nextTones].filter((t) => !prevTones.has(t));
  const removed = [...prevTones].filter((t) => !nextTones.has(t));
  if (added.length + removed.length >= Math.ceil(toneThreshold * 10)) {
    findings.push({
      field: 'text.tone',
      summary: `Tone changed (+${added.length}/-${removed.length})`,
    });
  }

  return findings;
}
