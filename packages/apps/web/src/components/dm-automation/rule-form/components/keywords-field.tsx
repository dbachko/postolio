import { useMemo, useState } from 'react';
import type { CreateRuleInput } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface KeywordsFieldProps {
  triggerConfig: CreateRuleInput['triggerConfig'];
  onChange: (triggerConfig: CreateRuleInput['triggerConfig']) => void;
}

export function KeywordsField({ triggerConfig, onChange }: KeywordsFieldProps) {
  const [keywordInput, setKeywordInput] = useState('');

  const keywords = useMemo(() => triggerConfig.keywords ?? [], [triggerConfig.keywords]);

  const addKeyword = () => {
    const trimmed = keywordInput.trim();
    if (!trimmed || keywords.includes(trimmed)) {
      return;
    }
    onChange({ ...triggerConfig, keywords: [...keywords, trimmed] });
    setKeywordInput('');
  };

  const removeKeyword = (keyword: string) => {
    onChange({
      ...triggerConfig,
      keywords: keywords.filter((k) => k !== keyword),
    });
  };

  return (
    <div>
      <Label>Keywords</Label>
      <div className="mt-1 flex gap-2">
        <Input
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') {
              return;
            }
            e.preventDefault();
            addKeyword();
          }}
          placeholder="Type keyword and press Enter"
        />
        <Button type="button" onClick={addKeyword}>
          Add
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {keywords.map((keyword) => (
          <span
            key={keyword}
            className="bg-secondary inline-flex items-center gap-1 rounded px-2 py-1 text-sm"
          >
            {keyword}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => removeKeyword(keyword)}
              className="text-muted-foreground hover:text-destructive h-4 w-4 p-0 hover:bg-transparent"
              aria-label={`Remove keyword ${keyword}`}
            >
              ×
            </Button>
          </span>
        ))}
      </div>
    </div>
  );
}
