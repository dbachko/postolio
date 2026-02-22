import { randomUUID } from 'crypto';

export function slugify(value: string, maxLength = 64): string {
  const normalized = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    return 'recipe';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength).replace(/-+$/g, '');
}

export function withRandomSuffix(slug: string, suffixLength = 6): string {
  const suffix = randomUUID().replace(/-/g, '').slice(0, suffixLength);
  return `${slug}-${suffix}`;
}
