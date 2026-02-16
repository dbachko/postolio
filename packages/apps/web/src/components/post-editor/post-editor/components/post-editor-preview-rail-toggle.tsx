import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type PostEditorPreviewRailToggleProps = {
  previewOpen: boolean;
  onToggle: () => void;
  size?: 'icon' | 'icon-lg';
};

export function PostEditorPreviewRailToggle({
  previewOpen,
  onToggle,
  size = 'icon-lg',
}: PostEditorPreviewRailToggleProps) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size={size}
            aria-label={previewOpen ? 'Hide preview' : 'Open preview'}
            className="text-muted-foreground shadow-none"
            onClick={onToggle}
          >
            {previewOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p className="text-sm">{previewOpen ? 'Hide preview' : 'Open preview'}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
