import { useState } from 'react';
import { ChevronDown, Megaphone, Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type CreateActionsMenuProps = {
  selectedBrandId: string | null;
  onCreatePost: () => void;
  onCreateCampaign: () => void;
  onUploadAsset: (brandId: string) => void;
};

export function CreateActionsMenu({
  selectedBrandId,
  onCreatePost,
  onCreateCampaign,
  onUploadAsset,
}: CreateActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const hasSelectedBrand = Boolean(selectedBrandId);

  return (
    <>
      <ButtonGroup className="hidden sm:inline-flex">
        <Button
          size="sm"
          className="h-9 gap-2 pr-2 pl-3"
          onClick={onCreatePost}
          aria-label="Create new post"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Post
        </Button>
        <Popover open={open} onOpenChange={setOpen}>
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button size="icon" className="h-9 w-9" aria-label="Open create actions menu">
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>More create options</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <PopoverContent align="end" className="w-80 p-2">
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full items-start justify-start gap-3 px-3 py-2"
                disabled={!hasSelectedBrand}
                onClick={() => {
                  setOpen(false);
                  onCreateCampaign();
                }}
              >
                <Megaphone className="text-muted-foreground mt-0.5 h-4 w-4" aria-hidden="true" />
                <span className="flex flex-col items-start gap-0.5 text-left">
                  <span className="text-sm font-medium">New Campaign</span>
                  <span className="text-muted-foreground text-xs leading-snug">
                    Plan and organize your upcoming posts.
                  </span>
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full items-start justify-start gap-3 px-3 py-2"
                disabled={!hasSelectedBrand}
                onClick={() => {
                  if (!selectedBrandId) return;
                  setOpen(false);
                  onUploadAsset(selectedBrandId);
                }}
              >
                <Upload className="text-muted-foreground mt-0.5 h-4 w-4" aria-hidden="true" />
                <span className="flex flex-col items-start gap-0.5 text-left">
                  <span className="text-sm font-medium">Upload Asset</span>
                  <span className="text-muted-foreground text-xs leading-snug">
                    Add photos and videos to reuse later.
                  </span>
                </span>
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </ButtonGroup>

      <Button
        size="icon"
        className="mr-2 h-9 w-9 sm:mr-0 sm:hidden"
        onClick={onCreatePost}
        aria-label="Create new post"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
      </Button>
    </>
  );
}
