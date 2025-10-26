import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface PostCaptionEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  showCharacterCount?: boolean;
  disabled?: boolean;
}

export function PostCaptionEditor({
  value,
  onChange,
  placeholder = 'Write your caption...',
  minHeight = 'min-h-32',
  showCharacterCount = true,
  disabled = false,
}: PostCaptionEditorProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="caption">Caption</Label>
      <Textarea
        id="caption"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${minHeight} resize-none`}
        disabled={disabled}
      />
      {showCharacterCount && (
        <div className="text-muted-foreground text-right text-xs">{value.length} characters</div>
      )}
    </div>
  );
}
