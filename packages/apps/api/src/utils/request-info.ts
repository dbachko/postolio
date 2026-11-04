import type { FastifyRequest } from 'fastify';

export function getUserAgent(request: FastifyRequest): string | undefined {
  const ua = request.headers['user-agent'];
  if (typeof ua === 'string') {
    return ua;
  }
  if (Array.isArray(ua)) {
    return ua[0];
  }
  return undefined;
}

/**
 * Forwarding headers are client-controlled, so only Fastify may interpret them, using the
 * hop count from createTrustProxy().
 */
export function getClientIp(request: FastifyRequest): string {
  return request.ip || 'unknown';
}

/** Proxies in front of the API: nginx on a VPS, CloudFront + ALB on AWS. */
export function createTrustProxy(env = process.env.TRUST_PROXY_HOPS) {
  const parsed = Number.parseInt(env ?? '', 10);
  const hops = Number.isInteger(parsed) && parsed >= 0 ? parsed : 1;
  return (_address: string, hop: number) => hop < hops;
}

function detectOs(ua: string): string {
  const isIPhone = /iPhone/i.test(ua);
  if (isIPhone) {
    return 'iPhone';
  }

  if (/iPad/i.test(ua)) {
    return 'iPad';
  }

  if (/Android/i.test(ua)) {
    return /Mobile/i.test(ua) ? 'Android Phone' : 'Android Tablet';
  }

  if (/Mac OS X|Macintosh/i.test(ua)) {
    return 'macOS';
  }

  if (/Windows NT/i.test(ua)) {
    return 'Windows';
  }

  if (/CrOS/i.test(ua)) {
    return 'Chrome OS';
  }

  if (/Linux/i.test(ua)) {
    return 'Linux';
  }

  return '';
}

function detectBrowser(ua: string): string {
  const edge = ua.match(/Edg\/(\d+)/i);
  if (edge) {
    return `Edge ${edge[1]}`;
  }

  const opera = ua.match(/OPR\/(\d+)/i);
  if (opera) {
    return `Opera ${opera[1]}`;
  }

  const firefox = ua.match(/Firefox\/(\d+)/i);
  if (firefox) {
    return `Firefox ${firefox[1]}`;
  }

  const chrome = ua.match(/Chrome\/(\d+)/i) || ua.match(/CriOS\/(\d+)/i);
  if (chrome) {
    return `Chrome ${chrome[1]}`;
  }

  const safari = !/Chrome|CriOS|Chromium|Edg|OPR/i.test(ua) && ua.match(/Version\/(\d+).+Safari/i);
  if (safari) {
    return 'Safari';
  }

  return '';
}

export function parseDeviceName(userAgent?: string | null): string | undefined {
  if (!userAgent) {
    return undefined;
  }
  const ua = userAgent;
  const os = detectOs(ua);
  const browser = detectBrowser(ua);

  if (!os && !browser) {
    return undefined;
  }
  if (!browser && os) {
    return os;
  }
  if (!os && browser) {
    return browser;
  }
  return `${browser} on ${os}`;
}
