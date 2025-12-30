import { useRef, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { EmojiPickerButton } from '@/components/caption/emoji-picker-button';
import { HashtagSuggestionsButton } from '@/components/caption/hashtag-suggestions-button';
import { VariablesPickerButton } from '../variables-picker-button';

interface DMTemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  brandId?: string;
  placeholder?: string;
  minHeight?: string;
  maxLength?: number;
  disabled?: boolean;
  label?: string;
  id?: string;
  required?: boolean;
  helperText?: ReactNode;
  rows?: number;
}

export function DMTemplateEditor({
  value,
  onChange,
  brandId,
  placeholder = 'Write your message template...',
  minHeight = 'min-h-24',
  maxLength = 2000,
  disabled = false,
  label = 'Message Template',
  id = 'dm-template',
  required = false,
  helperText,
  rows = 4,
}: DMTemplateEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInsert = (text: string) => {
    if (!textareaRef.current) return;

    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    // Insert text at cursor position
    const newValue = value.substring(0, start) + text + value.substring(end);

    // Check if new value exceeds max length
    if (newValue.length <= maxLength) {
      onChange(newValue);

      // Set cursor position after inserted text
      setTimeout(() => {
        textarea.focus();
        const newPosition = start + text.length;
        textarea.setSelectionRange(newPosition, newPosition);
      }, 0);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-2">
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      <div className="border-border overflow-hidden rounded-md border">
        <Textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={(e) => {
            const newValue = e.target.value;
            if (newValue.length <= maxLength) {
              onChange(newValue);
            }
          }}
          placeholder={placeholder}
          className={`${minHeight} resize-none rounded-b-none border-0 focus-visible:ring-0`}
          disabled={disabled}
          maxLength={maxLength}
          rows={rows}
        />
        <div className="border-border bg-muted/30 flex items-center justify-between gap-1 border-t px-2 py-1">
          <div className="flex items-center gap-1">
            <VariablesPickerButton onVariableSelect={handleInsert} disabled={disabled} />
            <Separator orientation="vertical" className="h-5" />
            <EmojiPickerButton onEmojiSelect={handleInsert} disabled={disabled} />
            <Separator orientation="vertical" className="h-5" />
            <HashtagSuggestionsButton
              brandId={brandId}
              onHashtagSelect={(hashtag) => handleInsert(`#${hashtag} `)}
              disabled={disabled}
            />
          </div>
          <div className="text-muted-foreground text-xs">
            {value.length}/{maxLength}
          </div>
        </div>
      </div>
      {helperText && <div className="text-muted-foreground text-xs">{helperText}</div>}
    </div>
  );
}
