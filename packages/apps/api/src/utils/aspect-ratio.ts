export interface HasDimensions {
  width?: number | null;
  height?: number | null;
}

/**
 * Returns true when all items with width/height share (approximately)
 * the same aspect ratio. Items missing dimensions are ignored.
 *
 * Tolerance is expressed as an absolute difference between ratios
 * (e.g., 0.01 ≈ 1%).
 */
export function haveUniformAspectRatio(items: HasDimensions[], tolerance: number = 0.01): boolean {
  const ratios: number[] = [];

  for (const item of items) {
    const width = item.width ?? null;
    const height = item.height ?? null;

    if (!width || !height || height === 0) {
      continue;
    }

    ratios.push(width / height);
  }

  if (ratios.length <= 1) {
    return true;
  }

  const reference = ratios[0];
  return ratios.every((ratio) => Math.abs(ratio - reference) <= tolerance);
}
