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

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? (x.filter((v) => typeof v === 'string') as string[]) : [];
}

function detectPaletteFinding(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
  paletteThreshold: number
): DriftFinding | null {
  const prevPalette = asStringArray(prev?.palette);
  const nextPalette = asStringArray(next?.palette);
  const similarity = jaccard(prevPalette, nextPalette);
  if (similarity >= paletteThreshold) {
    return null;
  }

  return {
    field: 'visual.palette',
    summary: `Palette similarity low (J=${similarity.toFixed(2)})`,
  };
}

function detectToneFinding(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
  toneThreshold: number
): DriftFinding | null {
  const prevTones = new Set<string>(asStringArray(prev?.tone));
  const nextTones = new Set<string>(asStringArray(next?.tone));
  const added = [...nextTones].filter((tone) => !prevTones.has(tone));
  const removed = [...prevTones].filter((tone) => !nextTones.has(tone));
  if (added.length + removed.length < Math.ceil(toneThreshold * 10)) {
    return null;
  }

  return {
    field: 'text.tone',
    summary: `Tone changed (+${added.length}/-${removed.length})`,
  };
}

export function detectDrift(prev: unknown, next: unknown): DriftFinding[] {
  const p = prev as Record<string, unknown> | undefined;
  const n = next as Record<string, unknown> | undefined;
  const findings: DriftFinding[] = [];
  const toneThreshold = Number(process.env.BRAND_ANALYSIS_DRIFT_TONE_THRESHOLD || 0.15);
  const paletteThreshold = Number(process.env.BRAND_ANALYSIS_DRIFT_PALETTE_JACCARD || 0.6);

  const pVisual = (p?.visual as Record<string, unknown> | undefined) || undefined;
  const nVisual = (n?.visual as Record<string, unknown> | undefined) || undefined;
  const paletteFinding = detectPaletteFinding(pVisual, nVisual, paletteThreshold);
  if (paletteFinding) {
    findings.push(paletteFinding);
  }

  // Placeholder: tone drift could be computed via numeric vector; here we note change count.
  const pText = (p?.text as Record<string, unknown> | undefined) || undefined;
  const nText = (n?.text as Record<string, unknown> | undefined) || undefined;
  const toneFinding = detectToneFinding(pText, nText, toneThreshold);
  if (toneFinding) {
    findings.push(toneFinding);
  }

  return findings;
}
