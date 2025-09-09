import { useState, useMemo, useCallback, memo } from "react";
import { Copy, Check } from "lucide-react";

const suggestions = [
  "coffee mountain bicycle sunset",
  "purple ocean guitar morning",
  "library forest dancing stars",
  "crystal bridge rainbow valley",
  "summer breeze flowing river",
  "gentle rain peaceful garden",
];

export const PassphraseSuggestion = memo(() => {
  const suggestion = useMemo(
    () => suggestions[Math.floor(Math.random() * suggestions.length)],
    [], // Generate once per component mount
  );
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(suggestion);
      } else {
        // Fallback for older browsers or non-secure contexts
        const textArea = document.createElement("textarea");
        textArea.value = suggestion;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy passphrase:", err);
      // Could show toast notification here
    }
  }, [suggestion]);

  return (
    <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
      <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
        Try a passphrase instead:
      </h4>
      <div className="flex items-center gap-2 p-2 bg-white dark:bg-gray-900 rounded border border-blue-200 dark:border-blue-700">
        <code className="flex-1 text-sm text-blue-700 dark:text-blue-300 font-mono">
          {suggestion}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="p-2 hover:bg-blue-100 dark:hover:bg-blue-900 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label={copied ? "Copied to clipboard" : "Copy passphrase"}
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
