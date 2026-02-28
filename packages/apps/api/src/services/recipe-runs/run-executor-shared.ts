import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const PROMPTS_DIR = fileURLToPath(new URL('./prompts/', import.meta.url));

export function now(): Date {
  return new Date();
}

export function truncateText(value: string, maxLen = 32_000): string {
  const normalized = String(value ?? '');
  if (normalized.length <= maxLen) {
    return normalized;
  }

  return `${normalized.slice(0, maxLen)}…`;
}

export function isYmd(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((segment) => Number.parseInt(segment, 10));
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  date.setUTCDate(date.getUTCDate() + days);

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function extractHashtagsFromCaption(caption: string): string[] {
  const matches = String(caption || '').match(/#[a-zA-Z0-9_]+/g) || [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of matches) {
    const value = raw.replace(/^#/, '').trim();
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    out.push(value);
  }

  return out;
}

function stripMarkdownCodeFence(input: string): string {
  const raw = String(input || '').trim();
  if (!raw.startsWith('```')) {
    return raw;
  }

  const firstNewline = raw.indexOf('\n');
  if (firstNewline < 0) {
    return raw;
  }

  const withoutHeader = raw.slice(firstNewline + 1);
  const fenceEnd = withoutHeader.lastIndexOf('```');
  if (fenceEnd < 0) {
    return raw;
  }

  return withoutHeader.slice(0, fenceEnd).trim();
}

function extractJsonArraySubstring(input: string): string | null {
  const raw = String(input || '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < 0 || end <= start) {
    return null;
  }

  return raw.slice(start, end + 1).trim();
}

function parseJsonCandidates(raw: string): string[] {
  return Array.from(
    new Set(
      [
        raw,
        stripMarkdownCodeFence(raw),
        extractJsonArraySubstring(raw),
        extractJsonArraySubstring(stripMarkdownCodeFence(raw)),
      ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    )
  );
}

function parseArrayLikePayload(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    const maybeItems = (value as any).items;
    if (Array.isArray(maybeItems)) {
      return maybeItems;
    }

    const maybePosts = (value as any).posts;
    if (Array.isArray(maybePosts)) {
      return maybePosts;
    }
  }

  if (typeof value !== 'string') {
    return [];
  }

  const raw = value.trim();
  if (!raw) {
    return [];
  }

  const candidates = parseJsonCandidates(raw);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && typeof parsed === 'object') {
        const maybeItems = (parsed as any).items;
        if (Array.isArray(maybeItems)) {
          return maybeItems;
        }
        const maybePosts = (parsed as any).posts;
        if (Array.isArray(maybePosts)) {
          return maybePosts;
        }
      }
    } catch {
      continue;
    }
  }

  return [];
}

export function parsePostsJsonCandidate(value: unknown): any[] {
  const parsed = parseArrayLikePayload(value);
  return Array.isArray(parsed) ? parsed : [];
}

export function parseJsonArrayCandidate(value: unknown): unknown[] {
  return parseArrayLikePayload(value);
}

export async function loadPromptTemplate(relativePath: string): Promise<string> {
  let normalized = String(relativePath || '').trim();
  normalized = normalized.replace(/^prompts[\\/]/, '');
  if (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }

  if (!normalized) {
    throw new Error('prompt_template is empty');
  }

  if (normalized.includes('..') || normalized.startsWith('/') || normalized.startsWith('\\')) {
    throw new Error('prompt_template must be a safe relative path');
  }

  const fullPath = path.resolve(PROMPTS_DIR, normalized);
  if (!fullPath.startsWith(PROMPTS_DIR)) {
    throw new Error('prompt_template path traversal is not allowed');
  }

  return fs.readFile(fullPath, 'utf8');
}
