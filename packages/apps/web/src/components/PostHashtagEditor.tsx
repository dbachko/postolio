import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface PostHashtagEditorProps {
  hashtags: string[];
  onChange: (hashtags: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function PostHashtagEditor({
  hashtags,
  onChange,
  placeholder = 'Add hashtags separated by spaces (e.g., #fashion #style #ootd)',
  disabled = false,
}: PostHashtagEditorProps) {
  const [input, setInput] = useState('');

  const sanitize = (tag: string) => tag.replace(/^#+/, '');

  // Initialize input from hashtags (strip any leading # from props)
  useEffect(() => {
    const sanitized = (hashtags || []).map(sanitize);
    setInput(sanitized.join(' '));
  }, [hashtags]);

  const handleInputChange = (value: string) => {
    setInput(value);

    // Parse hashtags from input and strip # symbols
    const parsedHashtags = value
      .split(/\s+/)
      .filter((tag) => tag.trim().length > 0)
      .map((tag) => tag.replace(/^#+/, '')) // Strip leading # symbols
      .filter((tag) => tag.length > 0); // Remove empty tags after stripping

    onChange(parsedHashtags);
  };

  const removeHashtag = (index: number) => {
    const newHashtags = hashtags.filter((_, i) => i !== index);
    onChange(newHashtags);
    setInput(newHashtags.join(' '));
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="hashtags">Hashtags</Label>
      <Input
        id="hashtags"
        value={input}
        onChange={(e) => handleInputChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      {hashtags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {hashtags.map((hashtag, index) => (
            <Badge
              key={index}
              variant="secondary"
              className={`${!disabled ? 'hover:bg-destructive/10 hover:text-destructive cursor-pointer' : ''}`}
              onClick={!disabled ? () => removeHashtag(index) : undefined}
            >
              #{sanitize(hashtag)} {!disabled && '×'}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
