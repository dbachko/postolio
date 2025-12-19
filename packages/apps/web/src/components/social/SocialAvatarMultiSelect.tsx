import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import type { ProfileAvatarProps } from '@/components/ui/profile-avatar';
import type { Platform } from '@/lib/platform-config';
import { getPlatformConfig } from '@/lib/platform-config';
import { cn } from '@/lib/utils';
import { SocialAccountAvatar } from '@/components/social/SocialAccountAvatar';

export interface SocialAvatarMultiSelectOption {
  id: string;
  platform: Platform;
  /** Short display label (e.g., "@account" or "Page Name"). */
  label?: string;
  /** Tooltip/aria label (defaults to "Platform · label"). */
  tooltipLabel?: string;
  /** Name used for avatar initials fallback (defaults to label). */
  avatarName?: string;
  avatarUrl?: string | null;
  disabled?: boolean;
}

export interface SocialAvatarMultiSelectProps {
  options: SocialAvatarMultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  size?: ProfileAvatarProps['size'];
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

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
    if (disabled) return;
    const option = options.find((o) => o.id === id);
    const isSelected = value.includes(id);
    if (!option) return;
    if (option.disabled && !isSelected) return;

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
