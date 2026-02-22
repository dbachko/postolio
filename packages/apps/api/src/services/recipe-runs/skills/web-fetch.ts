import { lookup } from 'dns/promises';

type WebFetchResult = {
  text: string;
  url: string;
  contentType: string | null;
  status: number;
};

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const bytes = parts.map((p) => Number(p));
  if (bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    return null;
  }
  return bytes;
}

function isPrivateIPv4(ip: string): boolean {
  const b = parseIPv4(ip);
  if (!b) {
    return false;
  }
  const [a, c] = b;

  if (a === 10) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  if (a === 0) {
    return true;
  }
  if (a === 169 && c === 254) {
    return true;
  }
  if (a === 172 && c >= 16 && c <= 31) {
    return true;
  }
  if (a === 192 && c === 168) {
    return true;
  }
  if (a === 100 && c >= 64 && c <= 127) {
    return true;
  } // CGNAT
  if (a >= 224) {
    return true;
  } // multicast/reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') {
    return true;
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  } // unique local
  if (normalized.startsWith('fe80')) {
    return true;
  } // link-local
  if (normalized.startsWith('ff')) {
    return true;
  } // multicast
  if (normalized.startsWith('2001:db8')) {
    return true;
  } // documentation range

  // IPv4-mapped IPv6
  const v4mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) {
    return isPrivateIPv4(v4mapped[1]);
  }

  return false;
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    return isPrivateIPv6(ip);
  }
  return isPrivateIPv4(ip);
}

function htmlToText(html: string): string {
  let out = html;
  out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  out = out.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  out = out.replace(/<!--([\s\S]*?)-->/g, '');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|ul|ol)>/gi, '\n');
  out = out.replace(/<[^>]+>/g, ' ');
  out = out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  out = out.replace(/&#(\d+);/g, (_m, code) => {
    const n = Number(code);
    if (!Number.isFinite(n) || n < 0) {
      return '';
    }
    try {
      return String.fromCodePoint(n);
    } catch {
      return '';
    }
  });
  out = out.replace(/\r/g, '');
  out = out.replace(/[ \t]+\n/g, '\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/[ \t]{2,}/g, ' ');
  return out.trim();
}

async function readStreamWithLimit(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(`Web fetch response exceeded maxBytes (${maxBytes})`);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

async function assertSafeRemoteUrl(url: URL): Promise<void> {
  if (url.protocol !== 'https:') {
    throw new Error('Only https URLs are allowed');
  }

  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Blocked hostname');
  }

  const addrs = await lookup(host, { all: true, verbatim: true });
  for (const addr of addrs) {
    if (isPrivateIp(addr.address)) {
      throw new Error('Blocked private IP range');
    }
  }
}

export async function webFetch(input: { url: string }, options?: { maxBytes?: number }) {
  const maxBytes = options?.maxBytes ?? 1_000_000;

  const startUrl = new URL(String(input?.url || '').trim());

  let current = startUrl;
  for (let i = 0; i < 4; i++) {
    await assertSafeRemoteUrl(current);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'PostolioRecipeRunner/1.0',
          accept: 'text/html,text/plain,application/json',
        },
      });

      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current);
        continue;
      }

      const contentTypeRaw = res.headers.get('content-type');
      const contentType = contentTypeRaw ? contentTypeRaw.split(';')[0]?.trim() : null;

      if (!res.ok) {
        throw new Error(`Web fetch failed with status ${res.status}`);
      }

      const body = res.body;
      if (!body) {
        return {
          text: '',
          url: current.toString(),
          contentType,
          status: res.status,
        } satisfies WebFetchResult;
      }

      const buf = await readStreamWithLimit(body, maxBytes);
      const text = buf.toString('utf8');

      let extracted = text;
      if (contentType === 'text/html') {
        extracted = htmlToText(text);
      }

      // Keep prompts bounded even if maxBytes is large.
      if (extracted.length > 20_000) {
        extracted = `${extracted.slice(0, 20_000)}…`;
      }

      return {
        text: extracted,
        url: current.toString(),
        contentType,
        status: res.status,
      } satisfies WebFetchResult;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Too many redirects');
}
