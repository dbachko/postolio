import { useRef } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Type } from 'lucide-react';
import { CaptionToolbar } from './caption/CaptionToolbar';

interface PostCaptionEditorProps {
  value: string;
  onChange: (value: string) => void;
  brandId?: string;
  placeholder?: string;
  minHeight?: string;
  showCharacterCount?: boolean;
  maxLength?: number;
  disabled?: boolean;
  showIcon?: boolean;
}

export function PostCaptionEditor({
  value,
  onChange,
  brandId,
  placeholder = 'Write your caption...',
  minHeight = 'min-h-32',
  showCharacterCount = true,
  maxLength = 2200,
  disabled = false,
  showIcon = false,
}: PostCaptionEditorProps) {
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
      <Label htmlFor="caption" className="flex items-center gap-2">
        {showIcon && <Type className="h-4 w-4" />}
        Caption <span className="text-destructive">*</span>
      </Label>
      <div className="border-border overflow-hidden rounded-md border">
        <Textarea
          ref={textareaRef}
          id="caption"
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
        />
        <CaptionToolbar
          brandId={brandId}
          onInsert={handleInsert}
          disabled={disabled}
          value={value}
          maxLength={maxLength}
          showCharacterCount={showCharacterCount}
        />
      </div>
    </div>
  );
}
