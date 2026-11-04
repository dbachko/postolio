export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  'dalle-3': 'OpenAI GPT Image',
  'gemini-2.5-flash': 'Gemini Flash Image',
  'gemini-3-pro': 'Gemini 3 Pro Image',
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
