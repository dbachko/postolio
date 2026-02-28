export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  'dalle-3': 'DALL-E 3',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-3-pro': 'Gemini 3 Pro',
};

export function getLogStatusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' {
  if (status === 'success') {
    return 'default';
  }
  if (status === 'fallback') {
    return 'secondary';
  }
  return 'destructive';
}
