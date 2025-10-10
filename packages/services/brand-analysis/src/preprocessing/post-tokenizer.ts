export function simplePostTokenizer(texts: string[]): string[] {
  const tokens = new Set<string>();
  for (const t of texts) {
    for (const w of t
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)) {
      if (w.length >= 3) tokens.add(w);
    }
  }
  return Array.from(tokens).slice(0, 200);
}
