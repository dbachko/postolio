import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Type } from 'lucide-react';

interface PostCaptionEditorProps {
  value: string;
  onChange: (value: string) => void;
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
  placeholder = 'Write your caption...',
  minHeight = 'min-h-32',
  showCharacterCount = true,
  maxLength = 2200,
  disabled = false,
  showIcon = false,
}: PostCaptionEditorProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="caption" className="flex items-center gap-2">
        {showIcon && <Type className="h-4 w-4" />}
        Caption <span className="text-destructive">*</span>
      </Label>
      <Textarea
        id="caption"
        value={value}
        onChange={(e) => {
          const newValue = e.target.value;
          if (newValue.length <= maxLength) {
            onChange(newValue);
          }
        }}
        placeholder={placeholder}
        className={`${minHeight} resize-none`}
        disabled={disabled}
        maxLength={maxLength}
      />
      {showCharacterCount && (
        <div className="text-muted-foreground text-right text-xs">
          {value.length}/{maxLength} characters
        </div>
      )}
    </div>
  );
}
