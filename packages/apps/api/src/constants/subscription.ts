export function getMaxScheduledAheadForTier(tier?: string): number {
  const t = (tier || 'free').toLowerCase();
  // Environment overrides (strings -> numbers); fallbacks below
  const envInt = (name: string, fallback: number) => {
    const raw = process.env[name];
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };

  switch (t) {
    case 'free':
      // Default: allow up to 10 future scheduled posts per brand
      return envInt('FREE_MAX_SCHEDULE_AHEAD', 10);
    case 'pro':
    case 'paid':
    case 'premium':
      // Default: generous limit for paid
      return envInt('PRO_MAX_SCHEDULE_AHEAD', 100);
    case 'enterprise':
      // Effectively unlimited
      return Number.POSITIVE_INFINITY;
    default:
      // Safe default for unknown tiers
      return envInt('DEFAULT_MAX_SCHEDULE_AHEAD', 20);
  }
}

export function getMaxQueueDepthForTier(tier?: string): number {
  const t = (tier || 'free').toLowerCase();
  const envInt = (name: string, fallback: number) => {
    const raw = process.env[name];
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };

  switch (t) {
    case 'free':
      return envInt('FREE_MAX_QUEUE_DEPTH', 10);
    case 'pro':
    case 'paid':
    case 'premium':
      return envInt('PRO_MAX_QUEUE_DEPTH', 5000);
    case 'enterprise':
      return Number.POSITIVE_INFINITY;
    default:
      return envInt('DEFAULT_MAX_QUEUE_DEPTH', 100);
  }
}
