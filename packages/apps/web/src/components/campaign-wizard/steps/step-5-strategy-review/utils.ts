import type { PillarDraft } from './types';

export const DEFAULT_PILLARS: PillarDraft[] = [
  { name: 'Pillar 1', percentage: 34 },
  { name: 'Pillar 2', percentage: 33 },
  { name: 'Pillar 3', percentage: 33 },
];

export function normalizePillars(ps: PillarDraft[]): PillarDraft[] {
  if (!ps.length) return ps;

  const clamped = ps.map((p) => ({
    name: p.name,
    percentage: Math.max(0, Math.min(100, Math.round(Number(p.percentage) || 0))),
  }));

  const sum = clamped.reduce((s, p) => s + p.percentage, 0);
  const diff = 100 - sum;

  if (diff !== 0) {
    const last = clamped.length - 1;
    clamped[last] = {
      ...clamped[last],
      percentage: Math.max(0, Math.min(100, clamped[last].percentage + diff)),
    };
  }

  return clamped;
}

export function isDefaultPillars(pillars: PillarDraft[]) {
  if (pillars.length !== DEFAULT_PILLARS.length) return false;
  return pillars.every(
    (pillar, index) =>
      pillar.name === DEFAULT_PILLARS[index]?.name &&
      pillar.percentage === DEFAULT_PILLARS[index]?.percentage
  );
}
