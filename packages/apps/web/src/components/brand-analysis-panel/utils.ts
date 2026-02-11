import type { CSSProperties } from 'react';
import { hexToRgba } from '@/utils/color';

function pickFromPalette(palette: string[], key: string): string | null {
  if (!palette.length) return null;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length] || null;
}

export function createChipStyleFor(palette?: string[]) {
  const paletteSafe = palette || [];

  return (key: string): CSSProperties | undefined => {
    const hex = pickFromPalette(paletteSafe, key);
    if (!hex) return undefined;

    return {
      backgroundColor: hexToRgba(hex, 0.15),
      border: `1px solid ${hex}`,
    };
  };
}
