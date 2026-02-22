export function sanitizeUrlForLog(url: string): {
  host?: string;
  path?: string;
  hasQuery?: boolean;
  extension?: string;
  scheme?: string;
} {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const extMatch = path.match(/\.([A-Za-z0-9]+)$/);
    return {
      host: parsed.host,
      path,
      hasQuery: !!parsed.search,
      extension: extMatch ? extMatch[1].toLowerCase() : undefined,
      scheme: parsed.protocol.replace(':', ''),
    };
  } catch {
    const extMatch = url.match(/\.([A-Za-z0-9]+)(?:\?|$)/);
    return {
      path: url.slice(0, 120),
      extension: extMatch ? extMatch[1].toLowerCase() : undefined,
    };
  }
}

export async function getSignedVideoUrl(videoKey: string): Promise<string> {
  const candidate = videoKey.trim();
  if (!candidate) {
    throw new Error('Media key is required for video publishing');
  }

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:') {
        url.protocol = 'https:';
      }
      return url.toString();
    } catch {
      return candidate;
    }
  }

  const cdnDomain = process.env.ASSETS_CDN_DOMAIN;
  if (cdnDomain) {
    const normalized = candidate.replace(/^\/+/, '');
    const cdn = cdnDomain.startsWith('http') ? cdnDomain : `https://${cdnDomain}`;
    return `${cdn.replace(/\/+$/, '')}/${normalized}`;
  }

  throw new Error('ASSETS_CDN_DOMAIN not configured for publisher video URLs');
}

export async function getSignedImageUrlFromKey(key: string): Promise<string> {
  const candidate = key.trim();
  if (!candidate) {
    throw new Error('Media key is required for image publishing');
  }

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:') {
        url.protocol = 'https:';
      }
      return url.toString();
    } catch {
      return candidate;
    }
  }

  const cdnDomain = process.env.ASSETS_CDN_DOMAIN;
  if (!cdnDomain) {
    throw new Error('ASSETS_CDN_DOMAIN not configured for publisher');
  }

  const normalized = candidate.replace(/^\/+/, '');
  if (normalized.startsWith(`${cdnDomain}/`)) {
    return `https://${normalized}`;
  }

  return `https://${cdnDomain}/${normalized}`;
}

export function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
