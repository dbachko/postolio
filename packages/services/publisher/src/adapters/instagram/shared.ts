import { API_BASE_URLS, API_VERSIONS } from '@postolio/aws';
import type { IGErrorPayload } from '../../types';
import { safeParseJson } from '../../utils/media';

export function graphBaseUrl(): string {
  return `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}`;
}

export function asIGErrorPayload(value: unknown): IGErrorPayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (!('error' in value)) {
    return null;
  }

  return value as IGErrorPayload;
}

export async function parseInstagramErrorResponse(response: Response): Promise<{
  raw: string;
  payload: IGErrorPayload | null;
  message: string;
  title?: string;
}> {
  const raw = await response.text();
  const payload = asIGErrorPayload(safeParseJson(raw));
  const message = payload?.error?.error_user_msg || payload?.error?.message || raw;
  const title = payload?.error?.error_user_title;

  return {
    raw,
    payload,
    message,
    title,
  };
}

export function buildInstagramError(
  message: string,
  meta: Record<string, unknown>
): Error & { meta?: Record<string, unknown> } {
  const error = new Error(message) as Error & { meta?: Record<string, unknown> };
  error.meta = meta;
  return error;
}

export function isNotReadyMessage(message: string | undefined): boolean {
  if (!message) {
    return false;
  }

  return /not ready|not\s+ready\s+for\s+publishing|finish processing|processing|cannot\s+be\s+found/i.test(
    message
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
