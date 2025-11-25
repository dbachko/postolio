import { useState, lazy, Suspense } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Smile } from 'lucide-react';
import type { EmojiClickData, Theme } from 'emoji-picker-react';

// Lazy load the emoji picker to reduce initial bundle size
const EmojiPicker = lazy(() => import('emoji-picker-react'));

interface EmojiPickerButtonProps {
  onEmojiSelect: (emoji: string) => void;
  disabled?: boolean;
}

export function EmojiPickerButton({ onEmojiSelect, disabled }: EmojiPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const { resolvedTheme } = useTheme();

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    onEmojiSelect(emojiData.emoji);
    setOpen(false);
  };

  // Map resolved theme to emoji picker theme
  const emojiTheme: Theme = (resolvedTheme === 'dark' ? 'dark' : 'light') as Theme;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="text-muted-foreground hover:text-foreground h-8 gap-2"
        >
          <Smile className="h-4 w-4" />
          <span className="text-xs">Emoji</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        {open && (
          <Suspense
            fallback={
              <div className="flex h-[400px] w-[350px] items-center justify-center">
                <div className="text-muted-foreground text-sm">Loading emojis...</div>
              </div>
            }
          >
            <EmojiPicker
              onEmojiClick={handleEmojiClick}
              theme={emojiTheme}
              width="350px"
              height="400px"
              previewConfig={{ showPreview: false }}
              searchPlaceHolder="Search emojis..."
              skinTonesDisabled
            />
          </Suspense>
        )}
      </PopoverContent>
    </Popover>
  );
}
