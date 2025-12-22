export const SLOT_CONFLICT_WINDOW_MS = 60 * 1000; // 1 minute

export function findOccupiedTime(params: {
  candidateUtcMs: number;
  occupiedUtcMsSorted: number[];
  windowMs: number;
}): number | null {
  const { candidateUtcMs, occupiedUtcMsSorted, windowMs } = params;
  if (occupiedUtcMsSorted.length === 0) return null;

  // Binary search for nearest occupied time.
  let lo = 0;
  let hi = occupiedUtcMsSorted.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = occupiedUtcMsSorted[mid]!;
    if (t === candidateUtcMs) return t;
    if (t < candidateUtcMs) lo = mid + 1;
    else hi = mid - 1;
  }

  const left = hi >= 0 ? occupiedUtcMsSorted[hi] : null;
  const right = lo < occupiedUtcMsSorted.length ? occupiedUtcMsSorted[lo] : null;

  const leftOk = left !== null && Math.abs(candidateUtcMs - left) < windowMs;
  const rightOk = right !== null && Math.abs(candidateUtcMs - right) < windowMs;

  if (leftOk && rightOk) {
    return Math.abs(candidateUtcMs - left!) <= Math.abs(candidateUtcMs - right!) ? left : right;
  }
  if (leftOk) return left;
  if (rightOk) return right;
  return null;
}

export function isTimeOccupied(params: {
  candidateUtcMs: number;
  occupiedUtcMsSorted: number[];
  windowMs: number;
}): boolean {
  return findOccupiedTime(params) !== null;
}
