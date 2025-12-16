export const getCampaignStatusColor = (status: string): string => {
  switch (status) {
    case 'active':
      return '#22c55e';
    case 'preview':
      return '#3b82f6';
    case 'creating':
    case 'processing':
      return '#f59e0b';
    case 'failed':
      return '#ef4444';
    case 'paused':
      return '#6b7280';
    case 'completed':
      return '#10b981';
    default:
      return '#e5e7eb';
  }
};

export const getFrequencyLabel = (frequency: string): string => {
  const labels: Record<string, string> = {
    daily: 'Daily',
    every2days: 'Every 2 Days',
    '3weekly': '3x Weekly',
  };
  return labels[frequency] || frequency;
};

export const getStyleLabel = (style: unknown): string => {
  const labels: Record<string, string> = {
    modern: 'Modern & Minimalist',
    vibrant: 'Vibrant & Colorful',
    professional: 'Professional & Corporate',
    casual: 'Casual & Friendly',
    luxury: 'Luxury & Premium',
    vintage: 'Vintage & Retro',
  };
  if (Array.isArray(style)) {
    const cleaned = style
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter((s) => s.length > 0);
    if (cleaned.length === 0) return '—';
    return cleaned.map((s) => labels[s] || s).join(', ');
  }
  if (typeof style === 'string') {
    const trimmed = style.trim();
    if (!trimmed) return '—';
    return labels[trimmed] || trimmed;
  }
  return '—';
};
