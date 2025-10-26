import { useState, useMemo, useCallback, memo } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

const suggestions = [
  'coffee mountain bicycle sunset',
  'purple ocean guitar morning',
  'library forest dancing stars',
  'crystal bridge rainbow valley',
  'summer breeze flowing river',
  'gentle rain peaceful garden',
];

export const PassphraseSuggestion = memo(() => {
  const suggestion = useMemo(
    () => suggestions[Math.floor(Math.random() * suggestions.length)],
    [] // Generate once per component mount
  );
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(suggestion);
      } else {
        // Fallback for older browsers or non-secure contexts
        const textArea = document.createElement('textarea');
        textArea.value = suggestion;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy passphrase:', err);
      // Could show toast notification here
    }
  }, [suggestion]);

  return (
    <div className="bg-muted mt-4 rounded-lg border p-3">
      <h4 className="text-foreground mb-2 text-sm font-medium">Try a passphrase instead:</h4>
      <div className="bg-background flex items-center gap-2 rounded border p-2">
        <code className="text-foreground flex-1 font-mono text-sm">{suggestion}</code>
        <Button
          type="button"
          variant="ghost"
          onClick={handleCopy}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center p-2"
          aria-label={copied ? 'Copied to clipboard' : 'Copy passphrase'}
        >
          {copied ? (
            <Check size={20} className="text-foreground" />
          ) : (
            <Copy size={20} className="text-foreground" />
          )}
        </Button>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        Passphrases are easier to remember and type, especially on mobile!
      </p>
    </div>
  );
});
