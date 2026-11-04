import { customAlphabet } from 'nanoid';
import { downloadPublicAsset } from '../../utils/safe-download.js';
import { getAssetUrl } from '../../utils/s3.js';

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);
export const UNSORTED_COLLECTION_FILTER = 'unsorted';

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function guessExtension(mimeType: string, fallback = 'bin'): string {
  return MIME_EXTENSION_MAP[mimeType.toLowerCase()] || fallback;
}

export async function fetchBufferFromUrl(
  url: string
): Promise<{ buffer: Buffer; fileName: string; mimeType?: string }> {
  const result = await downloadPublicAsset(url);
  return {
    buffer: result.buffer,
    fileName: result.url.pathname.split('/').pop() || `asset-${nanoid()}`,
    mimeType: result.mimeType,
  };
}

export function mapAssetWithUrls<T extends { s3Key: string; thumbnailKey?: string | null }>(
  asset: T
): T & { url: string; thumbnailUrl: string | null } {
  return {
    ...asset,
    url: getAssetUrl(asset.s3Key),
    thumbnailUrl: asset.thumbnailKey ? getAssetUrl(asset.thumbnailKey) : null,
  };
}

export function mapAssetWithLabelsAndUrls<
  T extends {
    s3Key: string;
    thumbnailKey?: string | null;
    labelAssignments?: Array<{ taxonomyItemId: string }>;
  },
>(
  asset: T
): Omit<T, 'labelAssignments'> & {
  labelIds: string[];
  url: string;
  thumbnailUrl: string | null;
} {
  const { labelAssignments = [], ...rest } = asset;
  return {
    ...rest,
    labelIds: labelAssignments.map((assignment) => assignment.taxonomyItemId),
    url: getAssetUrl(asset.s3Key),
    thumbnailUrl: asset.thumbnailKey ? getAssetUrl(asset.thumbnailKey) : null,
  };
}
