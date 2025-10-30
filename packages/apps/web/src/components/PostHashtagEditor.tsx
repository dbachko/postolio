import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Hash, Plus } from 'lucide-react';

interface PostHashtagEditorProps {
  hashtags: string[];
  onChange: (hashtags: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  showIcon?: boolean;
}

export function PostHashtagEditor({
  hashtags,
  onChange,
  placeholder = 'Type a hashtag and press Enter to add',
  disabled = false,
  showIcon = false,
}: PostHashtagEditorProps) {
  const [input, setInput] = useState('');

  const sanitize = (tag: string) => tag.replace(/^#+/, '').trim();

  const addHashtag = () => {
    if (!input.trim() || disabled) return;

    // Sanitize and validate the input
    const newTag = sanitize(input);

    if (!newTag) {
      setInput('');
      return;
    }

    // Check if hashtag already exists (case-insensitive)
    const exists = hashtags.some((tag) => sanitize(tag).toLowerCase() === newTag.toLowerCase());

    if (!exists) {
      onChange([...hashtags, newTag]);
    }

    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent form submission
      addHashtag();
    }
  };

  const removeHashtag = (index: number) => {
    if (disabled) return;
    const newHashtags = hashtags.filter((_, i) => i !== index);
    onChange(newHashtags);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="hashtags" className="flex items-center gap-2">
        {showIcon && <Hash className="h-4 w-4" />}
        Hashtags
      </Label>
      <div className="flex gap-2">
        <Input
          id="hashtags"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          onClick={addHashtag}
          disabled={disabled || !input.trim()}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Add hashtags one at a time. Press Enter or click + to add. Max 30 hashtags.
      </p>
      {hashtags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {hashtags.map((hashtag, index) => (
            <Badge
              key={index}
              variant="secondary"
              className={`${!disabled ? 'hover:bg-destructive/10 hover:text-destructive cursor-pointer transition-colors' : ''}`}
              onClick={!disabled ? () => removeHashtag(index) : undefined}
              role={!disabled ? 'button' : undefined}
              tabIndex={!disabled ? 0 : undefined}
              onKeyDown={
                !disabled
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        removeHashtag(index);
                      }
                    }
                  : undefined
              }
            >
              #{sanitize(hashtag)} {!disabled && '×'}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
