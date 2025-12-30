import { Separator } from '@/components/ui/separator';
import { EmojiPickerButton } from '@/components/caption/emoji-picker-button';
import { HashtagSuggestionsButton } from '@/components/caption/hashtag-suggestions-button';
import { SnippetPickerButton } from '@/components/caption/snippet-picker-button';

interface CaptionToolbarProps {
  brandId: string | undefined;
  onInsert: (text: string) => void;
  disabled?: boolean;
  value?: string;
  maxLength?: number;
}

export function CaptionToolbar({
  brandId,
  onInsert,
  disabled,
  value = '',
  maxLength = 2200,
}: CaptionToolbarProps) {
  return (
    <div className="border-border bg-muted/30 flex items-center justify-between gap-1 border-t px-2 py-1">
      <div className="flex items-center gap-1">
        <EmojiPickerButton onEmojiSelect={onInsert} disabled={disabled} />
        <Separator orientation="vertical" className="h-5" />
        <HashtagSuggestionsButton
          brandId={brandId}
          onHashtagSelect={(hashtag) => onInsert(`#${hashtag} `)}
          disabled={disabled}
        />
        <Separator orientation="vertical" className="h-5" />
        <SnippetPickerButton
          brandId={brandId}
          onSnippetSelect={(snippet) => onInsert(snippet.content)}
          disabled={disabled}
        />
      </div>
      <div className="text-muted-foreground text-xs">
        {value.length}/{maxLength}
      </div>
    </div>
  );
}
