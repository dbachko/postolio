export type SlotLaneKey = 'post' | 'reel' | 'story' | 'any';
export type ContentLaneKey = 'post' | 'reel' | 'story';

export function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 64) {
    return null;
  }
  return trimmed;
}

export function normalizeSlotLaneKey(value: unknown): SlotLaneKey | null {
  if (value === 'reel' || value === 'story' || value === 'post' || value === 'any') {
    return value;
  }
  return null;
}

export function normalizeContentLaneKey(value: unknown): ContentLaneKey | null {
  if (value === 'reel' || value === 'story' || value === 'post') {
    return value;
  }
  return null;
}

export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d;
}
