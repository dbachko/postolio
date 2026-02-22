// Simple change-point detection utilities (offline) for gating updates

export interface ChangePointDetection {
  hasChange: boolean;
  index?: number; // index of detected change
  score?: number; // magnitude score (method-dependent)
}

// Page-Hinkley test: detects abrupt changes in the mean of a signal
// series: numeric array (e.g., seasonal indicator 0/1 by time)
// delta: small drift tolerance around mean
// lambda: threshold for change detection
export function pageHinkley(series: number[], delta = 0.05, lambda = 5): ChangePointDetection {
  if (!Array.isArray(series) || series.length < 10) {
    return { hasChange: false };
  }
  let mean = 0;
  let ph = 0;
  let phMin = 0;
  let tChange = -1;
  for (let i = 0; i < series.length; i++) {
    const x = series[i];
    mean = (mean * i + x) / (i + 1);
    ph += x - mean - delta;
    if (ph < phMin) {
      phMin = ph;
    }
    if (ph - phMin > lambda) {
      tChange = i;
      break;
    }
  }
  return tChange >= 0
    ? { hasChange: true, index: tChange, score: ph - phMin }
    : { hasChange: false };
}

// Binary segmentation for single change using variance reduction (simple)
export function binarySegmentationOnce(series: number[], minSeg = 8): ChangePointDetection {
  const n = series.length;
  if (n < 2 * minSeg) {
    return { hasChange: false };
  }
  const mean = series.reduce((a, b) => a + b, 0) / n;
  const totalVar = series.reduce((acc, x) => acc + Math.pow(x - mean, 2), 0) / n;
  let bestIdx = -1;
  let bestGain = 0;
  for (let k = minSeg; k <= n - minSeg; k++) {
    const left = series.slice(0, k);
    const right = series.slice(k);
    const ml = left.reduce((a, b) => a + b, 0) / left.length;
    const mr = right.reduce((a, b) => a + b, 0) / right.length;
    const vl = left.reduce((a, x) => a + Math.pow(x - ml, 2), 0) / left.length;
    const vr = right.reduce((a, x) => a + Math.pow(x - mr, 2), 0) / right.length;
    const within = (vl * left.length + vr * right.length) / n;
    const gain = totalVar - within;
    if (gain > bestGain) {
      bestGain = gain;
      bestIdx = k;
    }
  }
  return bestIdx > 0 ? { hasChange: true, index: bestIdx, score: bestGain } : { hasChange: false };
}
