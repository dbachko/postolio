export function safePercent(value: unknown, decimals = 1, opts?: { assumeRatio?: boolean }) {
  let n = Number(value);
  if (!isFinite(n) || isNaN(n)) {
    return (0).toFixed(decimals);
  }
  if (opts?.assumeRatio || (Math.abs(n) > 0 && Math.abs(n) < 1)) {
    n *= 100;
  }
  const cap = 10000; // cap at 10k% to prevent scientific notation and runaway values
  if (n > cap) {
    n = cap;
  }
  if (n < -cap) {
    n = -cap;
  }
  return n.toFixed(decimals);
}

export function safeNumber(value: unknown, decimals = 1) {
  const n = Number(value);
  if (!isFinite(n) || isNaN(n)) {
    return (0).toFixed(decimals);
  }
  return n.toFixed(decimals);
}
