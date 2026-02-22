import type { FastifyRequest } from 'fastify';

export function getUserAgent(request: FastifyRequest): string | undefined {
  const ua = request.headers['user-agent'];
  return typeof ua === 'string' ? ua : Array.isArray(ua) ? ua[0] : undefined;
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

export function parseDeviceName(userAgent?: string | null): string | undefined {
  if (!userAgent) {
    return undefined;
  }
  const ua = userAgent;

  // Device type
  const isIPhone = /iPhone/i.test(ua);
  const isIPad = /iPad/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMobile = /Mobile/i.test(ua);

  // OS
  let os = '';
  if (isIPhone || isIPad) {
    os = isIPhone ? 'iPhone' : 'iPad';
  } else if (isAndroid) {
    os = isMobile ? 'Android Phone' : 'Android Tablet';
  } else if (/Mac OS X|Macintosh/i.test(ua)) {
    os = 'macOS';
  } else if (/Windows NT/i.test(ua)) {
    os = 'Windows';
  } else if (/CrOS/i.test(ua)) {
    os = 'Chrome OS';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
  }

  // Browser
  let browser = '';
  const edge = ua.match(/Edg\/(\d+)/i);
  const opr = ua.match(/OPR\/(\d+)/i);
  const firefox = ua.match(/Firefox\/(\d+)/i);
  const chrome = ua.match(/Chrome\/(\d+)/i) || ua.match(/CriOS\/(\d+)/i);
  const safari = !/Chrome|CriOS|Chromium|Edg|OPR/i.test(ua) && ua.match(/Version\/(\d+).+Safari/i);

  if (edge) {
    browser = `Edge ${edge[1]}`;
  } else if (opr) {
    browser = `Opera ${opr[1]}`;
  } else if (firefox) {
    browser = `Firefox ${firefox[1]}`;
  } else if (chrome) {
    browser = `Chrome ${chrome[1]}`;
  } else if (safari) {
    browser = 'Safari';
  }

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
