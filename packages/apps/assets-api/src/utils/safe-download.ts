import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import type { IncomingMessage } from 'node:http';
import ipaddr from 'ipaddr.js';

export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

function validateUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    (isIP(hostname) && !isPublicAddress(hostname))
  ) {
    throw new Error('Source URL must use public HTTPS on port 443');
  }
  return url;
}

/** DNS validation runs in the connection lookup, so the checked address is the one used. */
function openResponse(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        signal,
        agent: false,
        headers: { 'accept-encoding': 'identity' },
        lookup(hostname, options, callback) {
          void lookup(hostname, { all: true, verbatim: true })
            .then((addresses) => {
              if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
                callback(
                  new Error('Source hostname resolves to a non-public address'),
                  [],
                  undefined
                );
                return;
              }
              const address = addresses[0]!;
              if (options.all) {
                callback(null, [address]);
              } else {
                callback(null, address.address, address.family);
              }
            })
            .catch((error: Error) => callback(error, [], undefined));
        },
      },
      resolve
    );
    req.on('error', reject);
    req.end();
  });
}

export async function downloadPublicAsset(value: string): Promise<{
  buffer: Buffer;
  url: URL;
  mimeType: string | undefined;
}> {
  const signal = AbortSignal.timeout(30_000);
  let url = validateUrl(value);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await openResponse(url, signal);
    if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
      response.destroy();
      if (!response.headers.location || redirects === MAX_REDIRECTS) {
        throw new Error('Too many or invalid source redirects');
      }
      url = validateUrl(new URL(response.headers.location, url).href);
      continue;
    }
    if (
      response.statusCode !== 200 ||
      (response.headers['content-encoding'] &&
        response.headers['content-encoding'] !== 'identity') ||
      Number(response.headers['content-length'] || 0) > MAX_DOWNLOAD_BYTES
    ) {
      response.destroy();
      throw new Error('Source response is invalid or exceeds the download limit');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_DOWNLOAD_BYTES) {
        response.destroy();
        throw new Error('Source asset exceeds the download limit');
      }
      chunks.push(bytes);
    }
    return { buffer: Buffer.concat(chunks), url, mimeType: response.headers['content-type'] };
  }
  throw new Error('Source download failed');
}
