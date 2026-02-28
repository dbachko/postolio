import type { ReactNode } from 'react';
import { CircleFadingPlus, Film, Image as ImageIcon } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { InstagramContentType } from '@postolio/content-validation';

interface ContentTypeSelectorProps {
  mode: 'create' | 'edit';
  disabled: boolean;
  selectedPlatformsLength: number;
  value: InstagramContentType;
  onValueChange: (value: InstagramContentType) => void;
  disabledReasons: Record<InstagramContentType, string | null>;
}

function ContentTypeLabel({
  id,
  label,
  icon,
  disabledReason,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  disabledReason: string | null;
}) {
  const isDisabled = Boolean(disabledReason);
  const base = (
    <Label
      htmlFor={id}
      aria-disabled={isDisabled}
      className={cn(
        'peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-accent/50 border-input bg-background flex h-10 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-all sm:text-sm',
        isDisabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:bg-accent hover:text-accent-foreground cursor-pointer'
      )}
    >
      {icon}
      <span>{label}</span>
    </Label>
  );
  if (!disabledReason) {
    return base;
  }
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{base}</TooltipTrigger>
      <TooltipContent>
        <p className="text-sm">{disabledReason}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function ContentTypeOption({
  value,
  id,
  label,
  icon,
  disabledReason,
}: {
  value: InstagramContentType;
  id: string;
  label: string;
  icon: ReactNode;
  disabledReason: string | null;
}) {
  return (
    <div className="flex-1">
      <RadioGroupItem
        value={value}
        id={id}
        className="peer sr-only"
        disabled={Boolean(disabledReason)}
      />
      <ContentTypeLabel id={id} label={label} icon={icon} disabledReason={disabledReason} />
    </div>
  );
}

export function ContentTypeSelector({
  mode,
  disabled,
  selectedPlatformsLength,
  value,
  onValueChange,
  disabledReasons,
}: ContentTypeSelectorProps) {
  const postId = mode === 'create' ? 'type-post' : 'edit-type-post';
  const reelId = mode === 'create' ? 'type-reel' : 'edit-type-reel';
  const storyId = mode === 'create' ? 'type-story' : 'edit-type-story';

  return (
    <div className="space-y-2">
      <Label className="text-sm">
        Content Type <span className="text-destructive">*</span>
      </Label>
      <TooltipProvider>
        <RadioGroup
          value={value}
          onValueChange={(next) => onValueChange(next as InstagramContentType)}
          className="flex gap-2"
          disabled={disabled || selectedPlatformsLength === 0}
        >
          <ContentTypeOption
            value="post"
            id={postId}
            label="Post"
            icon={<ImageIcon className="h-3.5 w-3.5" />}
            disabledReason={disabledReasons.post}
          />
          <ContentTypeOption
            value="reel"
            id={reelId}
            label="Reel"
            icon={<Film className="h-3.5 w-3.5" />}
            disabledReason={disabledReasons.reel}
          />
          <ContentTypeOption
            value="story"
            id={storyId}
            label="Story"
            icon={<CircleFadingPlus className="h-3.5 w-3.5" />}
            disabledReason={disabledReasons.story}
          />
        </RadioGroup>
      </TooltipProvider>
    </div>
  );
}
