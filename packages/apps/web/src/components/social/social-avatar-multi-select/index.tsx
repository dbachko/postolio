import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { getPlatformConfig } from '@/lib/platform-config';
import { cn } from '@/lib/utils';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import type { SocialAvatarMultiSelectProps } from './types';

export function SocialAvatarMultiSelect({
  options,
  value,
  onChange,
  size = 'md',
  disabled = false,
  className,
  ariaLabel = 'Select social platforms',
}: SocialAvatarMultiSelectProps) {
  const toggle = (id: string) => {
    if (disabled) {
      return;
    }
    const option = options.find((o) => o.id === id);
    const isSelected = value.includes(id);
    if (!option) {
      return;
    }
    if (option.disabled && !isSelected) {
      return;
    }

    const next = new Set(value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange(Array.from(next));
  };

  return (
    <TooltipProvider>
      <div
        className={cn('flex flex-wrap items-center gap-2', className)}
        role="listbox"
        aria-multiselectable="true"
        aria-label={ariaLabel}
      >
        {options.map((opt) => {
          const selected = value.includes(opt.id);
          const platformConfig = getPlatformConfig(opt.platform);
          const platformLabel = platformConfig.displayName;
          const shortLabel = opt.label?.trim() || '';
          const tooltipLabel =
            opt.tooltipLabel?.trim() ||
            (shortLabel ? `${platformLabel} · ${shortLabel}` : platformLabel);
          const avatarName = opt.avatarName?.trim() || shortLabel || platformLabel;
          const optionDisabled = disabled || (Boolean(opt.disabled) && !selected);
          return (
            <Tooltip key={opt.id}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    'h-auto rounded-full p-0',
                    !optionDisabled && 'cursor-pointer',
                    optionDisabled && 'cursor-not-allowed'
                  )}
                  onClick={() => toggle(opt.id)}
                  disabled={optionDisabled}
                  role="option"
                  aria-selected={selected}
                  aria-label={tooltipLabel}
                >
                  <SocialAccountAvatar
                    platform={opt.platform}
                    name={avatarName}
                    src={opt.avatarUrl}
                    size={size}
                    selected={selected}
                    disabled={optionDisabled}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-sm">{tooltipLabel}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
