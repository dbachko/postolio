import { useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { getPlatformConfig } from '@/lib/platform-config';
import { cn } from '@/lib/utils';
import { SOCIAL_ACCOUNTS_PICKER_SIZE_CONFIG } from './constants';
import type { SocialAccountsPickerOption, SocialAccountsPickerProps } from './types';

export function SocialAccountsPicker({
  options,
  value,
  onChange,
  size = 'md',
  disabled = false,
  className,
  addLabel = 'Add social account',
  addTooltip,
  addButtonText,
  addButtonTextMode = 'always',
  required = false,
  selectedLayout = 'wrap',
  searchPlaceholder = 'Search accounts…',
}: SocialAccountsPickerProps) {
  const [open, setOpen] = useState(false);
  const addText = addButtonText?.trim() || '';
  const resolvedAddTooltip = (addTooltip?.trim() || 'Add destination').trim();
  const showRequired = required && !disabled;
  const isInvalid = showRequired && value.length === 0;
  const showAddText = Boolean(addText);
  const revealAddTextOnHover = showAddText && addButtonTextMode === 'hover';
  const sizeConfig =
    SOCIAL_ACCOUNTS_PICKER_SIZE_CONFIG[size] || SOCIAL_ACCOUNTS_PICKER_SIZE_CONFIG.md;

  const selectedOptions = useMemo(() => {
    const byId = new Map(options.map((o) => [o.id, o]));
    return value.map((id) => byId.get(id)).filter(Boolean) as SocialAccountsPickerOption[];
  }, [options, value]);

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

  const avatarItems = selectedOptions.map((opt) => {
    const platformConfig = getPlatformConfig(opt.platform);
    const platformLabel = platformConfig.displayName;
    const shortLabel = opt.label?.trim() || '';
    const tooltipLabel =
      opt.tooltipLabel?.trim() || (shortLabel ? `${platformLabel} · ${shortLabel}` : platformLabel);
    const avatarName = opt.avatarName?.trim() || shortLabel || platformLabel;

    return (
      <Tooltip key={opt.id}>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              'inline-flex items-center justify-center p-0',
              sizeConfig.triggerBoxClass,
              'rounded-full',
              !disabled && 'cursor-pointer',
              disabled && 'cursor-not-allowed'
            )}
            onClick={() => toggle(opt.id)}
            disabled={disabled}
            aria-label={`Remove ${tooltipLabel}`}
          >
            <SocialAccountAvatar
              platform={opt.platform}
              name={avatarName}
              src={opt.avatarUrl}
              size={size}
              selected
              disabled={disabled}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">{tooltipLabel}</p>
        </TooltipContent>
      </Tooltip>
    );
  });

  let addTriggerVariant: 'ghost' | 'outline' = 'ghost';
  let addTriggerSize: 'default' | 'icon' = 'icon';
  if (showAddText && !revealAddTextOnHover) {
    addTriggerVariant = 'outline';
    addTriggerSize = 'default';
  } else if (!showAddText && !revealAddTextOnHover) {
    addTriggerVariant = 'ghost';
    addTriggerSize = 'icon';
  }

  let addTriggerClassName = '';
  if (revealAddTextOnHover) {
    addTriggerClassName = cn(
      'group relative shrink-0 overflow-visible rounded-full bg-transparent p-0 shadow-none hover:bg-transparent',
      sizeConfig.triggerBoxClass
    );
  } else if (showAddText) {
    addTriggerClassName = cn('relative h-10 shrink-0 rounded-full px-4');
  } else {
    addTriggerClassName = cn('relative shrink-0 rounded-full p-0', sizeConfig.triggerBoxClass);
  }

  const addTrigger = (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant={addTriggerVariant}
                  size={addTriggerSize}
                  className={addTriggerClassName}
                  disabled={disabled}
                  aria-label={addLabel}
                  style={
                    !revealAddTextOnHover && !showAddText
                      ? {
                          boxShadow: `0 0 0 1px ${
                            isInvalid ? 'hsl(var(--destructive))' : 'hsl(var(--border))'
                          }`,
                        }
                      : undefined
                  }
                >
                  {revealAddTextOnHover ? (
                    <span
                      className={cn(
                        'bg-background absolute inset-y-0 left-0 z-10 flex items-center overflow-hidden rounded-full border shadow-xs transition-[width] duration-300 ease-out',
                        sizeConfig.triggerBoxWidthClass,
                        !disabled && sizeConfig.expandWidthVariantClass,
                        !disabled && 'group-hover:bg-accent group-hover:text-accent-foreground',
                        isInvalid && 'border-destructive',
                        'group-focus-visible:border-ring group-focus-visible:ring-ring/50 group-focus-visible:ring-[3px]'
                      )}
                    >
                      <span
                        className={cn(
                          'relative flex items-center justify-center',
                          sizeConfig.triggerBoxClass
                        )}
                      >
                        <Plus className={sizeConfig.plusIconClass} />
                      </span>
                      <span className="min-w-0 flex-1 truncate pr-4 text-sm whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                        {addText}
                      </span>
                    </span>
                  ) : (
                    <>
                      <Plus className={sizeConfig.plusIconClass} />
                      {showAddText ? <span className="text-sm">{addText}</span> : null}
                    </>
                  )}
                </Button>
              </PopoverTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-sm">{resolvedAddTooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>No platforms found.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const isSelected = value.includes(opt.id);
                const optionDisabled = disabled || (Boolean(opt.disabled) && !isSelected);
                const platformConfig = getPlatformConfig(opt.platform);
                const platformLabel = platformConfig.displayName;
                const shortLabel = opt.label?.trim() || '';
                const avatarName = opt.avatarName?.trim() || shortLabel || platformLabel;
                const searchValue = `${platformLabel} ${shortLabel} ${avatarName}`.trim();

                return (
                  <CommandItem
                    key={opt.id}
                    value={searchValue}
                    onSelect={() => toggle(opt.id)}
                    disabled={optionDisabled}
                    className="py-2"
                  >
                    <SocialAccountAvatar
                      platform={opt.platform}
                      name={avatarName}
                      src={opt.avatarUrl}
                      size="sm"
                      selected={isSelected}
                      disabled={optionDisabled}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{platformLabel}</div>
                      {shortLabel ? (
                        <div className="text-muted-foreground truncate text-xs">{shortLabel}</div>
                      ) : null}
                    </div>
                    {isSelected ? <Check className="ml-auto h-4 w-4" /> : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );

  return selectedLayout === 'scroll' ? (
    <div className={cn('flex items-center gap-2', className)}>
      <TooltipProvider>
        <div
          className={cn(
            'flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto overflow-y-visible pr-1',
            sizeConfig.triggerBoxHeightClass
          )}
        >
          {avatarItems}
        </div>
      </TooltipProvider>
      {addTrigger}
    </div>
  ) : (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <TooltipProvider>{avatarItems}</TooltipProvider>
      {addTrigger}
    </div>
  );
}
