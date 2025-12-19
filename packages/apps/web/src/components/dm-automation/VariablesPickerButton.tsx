import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Braces } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Variable {
  name: string;
  syntax: string;
  description: string;
}

const TEMPLATE_VARIABLES: Variable[] = [
  {
    name: 'Name',
    syntax: '{{name}}',
    description: "User's display name or username",
  },
  {
    name: 'Username',
    syntax: '{{username}}',
    description: "User's Instagram username",
  },
  {
    name: 'Post URL',
    syntax: '{{post_url}}',
    description: 'Link to the Instagram post (for comment triggers)',
  },
];

interface VariablesPickerButtonProps {
  onVariableSelect: (variable: string) => void;
  disabled?: boolean;
}

export function VariablesPickerButton({ onVariableSelect, disabled }: VariablesPickerButtonProps) {
  const [open, setOpen] = useState(false);

  const handleVariableClick = (syntax: string) => {
    onVariableSelect(syntax);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          disabled={disabled}
          title="Insert variable"
        >
          <Braces className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-2">
          <h4 className="leading-none font-medium">Template Variables</h4>
          <p className="text-muted-foreground text-sm">
            Click a variable to insert it at your cursor position
          </p>
          <div className="mt-4 space-y-1">
            {TEMPLATE_VARIABLES.map((variable) => (
              <Button
                key={variable.syntax}
                type="button"
                onClick={() => handleVariableClick(variable.syntax)}
                variant="ghost"
                className={cn(
                  'hover:bg-accent h-auto w-full justify-start rounded-md px-3 py-2 text-left transition-colors'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-medium">{variable.name}</div>
                    <div className="text-muted-foreground text-xs">{variable.description}</div>
                  </div>
                  <code className="bg-muted text-muted-foreground rounded px-2 py-1 font-mono text-xs">
                    {variable.syntax}
                  </code>
                </div>
              </Button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
