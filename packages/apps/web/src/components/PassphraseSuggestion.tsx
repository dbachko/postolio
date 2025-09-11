import { useState, useMemo, useCallback, memo } from 'react';
import { Copy, Check } from 'lucide-react';

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
    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
      <h4 className="mb-2 text-sm font-medium text-blue-900 dark:text-blue-100">
        Try a passphrase instead:
      </h4>
      <div className="flex items-center gap-2 rounded border border-blue-200 bg-white p-2 dark:border-blue-700 dark:bg-gray-900">
        <code className="flex-1 font-mono text-sm text-blue-700 dark:text-blue-300">
          {suggestion}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-2 transition-colors hover:bg-blue-100 dark:hover:bg-blue-900"
          aria-label={copied ? 'Copied to clipboard' : 'Copy passphrase'}
        >
          {copied ? (
            <Check size={20} className="text-green-600 dark:text-green-400" />
          ) : (
            <Copy size={20} className="text-blue-600 dark:text-blue-400" />
          )}
        </button>
      </div>
      <p className="mt-2 text-xs text-blue-700 dark:text-blue-300">
        Passphrases are easier to remember and type, especially on mobile!
      </p>
    </div>
  );
});
