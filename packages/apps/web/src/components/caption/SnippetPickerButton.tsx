import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ClipboardList } from 'lucide-react';
import { SnippetPickerModal } from './SnippetPickerModal';
import type { Snippet } from '@/lib/api';

interface SnippetPickerButtonProps {
  brandId: string | undefined;
  onSnippetSelect: (snippet: Snippet) => void;
  disabled?: boolean;
}

export function SnippetPickerButton({
  brandId,
  onSnippetSelect,
  disabled,
}: SnippetPickerButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Keyboard shortcut: Cmd/Ctrl + ; to open snippet picker
  useEffect(() => {
    if (!brandId || disabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Cmd (Mac) or Ctrl (Windows/Linux) + ;
      if ((event.metaKey || event.ctrlKey) && event.key === ';') {
        event.preventDefault();
        setIsOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [brandId, disabled]);

  if (!brandId) return null;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground h-8 w-8"
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        title="Insert snippet (⌘; / Ctrl+;)"
      >
        <ClipboardList className="h-4 w-4" />
      </Button>

      <SnippetPickerModal
        open={isOpen}
        onOpenChange={setIsOpen}
        brandId={brandId}
        onSnippetSelect={(snippet) => {
          onSnippetSelect(snippet);
          setIsOpen(false);
        }}
      />
    </>
  );
}
