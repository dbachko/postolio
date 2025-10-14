import { useState } from 'react';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { X } from 'lucide-react';
import { commonThemes } from '../../../constants/campaign';

interface ThemeChipInputProps {
  themes: string[];
  onChange: (themes: string[]) => void;
}

export function ThemeChipInput({ themes, onChange }: ThemeChipInputProps) {
  const [newTheme, setNewTheme] = useState('');

  const addTheme = (theme: string) => {
    const t = theme.trim();
    if (!t) return;
    if (themes.includes(t)) return;
    onChange([...themes, t]);
  };

  const removeTheme = (theme: string) => {
    onChange(themes.filter((t) => t !== theme));
  };

  const handleAddCustom = () => {
    addTheme(newTheme);
    setNewTheme('');
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-2 text-sm text-gray-600">Select from common themes:</p>
        <div className="flex flex-wrap gap-2">
          {commonThemes.map((theme) => (
            <Badge
              key={theme}
              variant={themes.includes(theme) ? 'default' : 'secondary'}
              className="hover:bg-primary/80 cursor-pointer"
              onClick={() => addTheme(theme)}
            >
              {theme}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm text-gray-600">Or add custom theme:</p>
        <div className="flex gap-2">
          <Input
            type="text"
            value={newTheme}
            onChange={(e) => setNewTheme(e.target.value)}
            placeholder="Enter custom theme..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddCustom();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={handleAddCustom}>
            Add
          </Button>
        </div>
      </div>

      {themes.length > 0 && (
        <div>
          <p className="mb-2 text-sm text-gray-600">Selected themes:</p>
          <div className="flex flex-wrap gap-2">
            {themes.map((theme) => (
              <Badge key={theme} variant="default" className="group">
                {theme}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeTheme(theme)}
                  className="ml-1 h-auto p-0 text-current hover:bg-transparent"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
