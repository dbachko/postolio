import { MAX_GOAL_LENGTH } from './constants';

export function sanitizeGoal(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_GOAL_LENGTH) return null;

  const sanitized = trimmed
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '');

  return sanitized;
}
