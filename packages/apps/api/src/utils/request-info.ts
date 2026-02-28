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

export function getClientIp(request: FastifyRequest): string {
  // Cloudflare header
  const cfIp = request.headers['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string') {
    return cfIp;
  }

  // Standard X-Forwarded-For (left-most is original client)
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    if (typeof forwarded === 'string') {
      const first = forwarded.split(',')[0]?.trim();
      if (first) {
        return first;
      }
    } else if (Array.isArray(forwarded) && forwarded[0]) {
      const first = forwarded[0].split(',')[0]?.trim();
      if (first) {
        return first;
      }
    }
  }

  // X-Real-IP (e.g., Nginx/CloudFront)
  const realIp = request.headers['x-real-ip'];
  if (realIp && typeof realIp === 'string') {
    return realIp;
  }

  // Fastify will honor X-Forwarded-For when trustProxy=true
  return request.ip || 'unknown';
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
