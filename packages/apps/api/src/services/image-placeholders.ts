const PLACEHOLDER_BASE = (
  process.env.PLACEHOLDER_IMAGE_BASE ||
  process.env.POST_SEED_IMAGE_BASE ||
  process.env.ASSETS_SEED_CDN_BASE ||
  'https://picsum.photos'
).replace(/\/$/, '');

const DEFAULT_SIZE = process.env.PLACEHOLDER_IMAGE_SIZE || '1024x1024';

function toBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function shouldUsePlaceholderImages(): boolean {
  if (toBoolean(process.env.SKIP_IMAGE_GENERATION)) {
    return true;
  }
  return false;
}

function normalizeSize(size: string): { width: number; height: number } {
  const parts = size.split(/[xX/]/);
  const width = parseInt(parts[0] || '', 10) || 1024;
  const height = parseInt(parts[1] || '', 10) || width;
  return { width, height };
}

export function generatePlaceholderImageUrl(size: string = DEFAULT_SIZE, salt?: string): string {
  const { width, height } = normalizeSize(size);
  const suffix = salt || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${PLACEHOLDER_BASE}/${width}/${height}?random=${encodeURIComponent(suffix)}`;
}
