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

import type { SocialAccountsPickerSizeConfig } from '../constants';
import type { SocialAccountsPickerOption } from '../types';

type TriggerVariant = 'ghost' | 'outline';
type TriggerSize = 'default' | 'icon';

function resolveTriggerStyle(args: {
  showAddText: boolean;
  revealAddTextOnHover: boolean;
  sizeConfig: SocialAccountsPickerSizeConfig;
}) {
  let variant: TriggerVariant = 'ghost';
  let size: TriggerSize = 'icon';

  if (args.showAddText && !args.revealAddTextOnHover) {
    variant = 'outline';
    size = 'default';
  }

  let className: string;
  if (args.revealAddTextOnHover) {
    className = cn(
      'group relative shrink-0 overflow-visible rounded-full bg-transparent p-0 shadow-none hover:bg-transparent',
      args.sizeConfig.triggerBoxClass
    );
  } else if (args.showAddText) {
    className = 'relative h-10 shrink-0 rounded-full px-4';
  } else {
    className = cn('relative shrink-0 rounded-full p-0', args.sizeConfig.triggerBoxClass);
  }

  return { variant, size, className };
}

function TriggerButton(props: {
  disabled: boolean;
  addLabel: string;
  addText: string;
  showAddText: boolean;
  revealAddTextOnHover: boolean;
  isInvalid: boolean;
  sizeConfig: SocialAccountsPickerSizeConfig;
  onClick?: () => void;
}) {
  const triggerStyle = resolveTriggerStyle({
    showAddText: props.showAddText,
    revealAddTextOnHover: props.revealAddTextOnHover,
    sizeConfig: props.sizeConfig,
  });

  return (
    <Button
      type="button"
      variant={triggerStyle.variant}
      size={triggerStyle.size}
      className={triggerStyle.className}
      disabled={props.disabled}
      aria-label={props.addLabel}
      style={
        !props.revealAddTextOnHover && !props.showAddText
          ? {
              boxShadow: `0 0 0 1px ${
                props.isInvalid ? 'hsl(var(--destructive))' : 'hsl(var(--border))'
              }`,
            }
          : undefined
      }
      onClick={props.onClick}
    >
      {props.revealAddTextOnHover ? (
        <span
          className={cn(
            'bg-background absolute inset-y-0 left-0 z-10 flex items-center overflow-hidden rounded-full border shadow-xs transition-[width] duration-300 ease-out',
            props.sizeConfig.triggerBoxWidthClass,
            !props.disabled && props.sizeConfig.expandWidthVariantClass,
            !props.disabled && 'group-hover:bg-accent group-hover:text-accent-foreground',
            props.isInvalid && 'border-destructive',
            'group-focus-visible:border-ring group-focus-visible:ring-ring/50 group-focus-visible:ring-[3px]'
          )}
        >
          <span
            className={cn(
              'relative flex items-center justify-center',
              props.sizeConfig.triggerBoxClass
            )}
          >
            <Plus className={props.sizeConfig.plusIconClass} />
          </span>
          <span className="min-w-0 flex-1 truncate pr-4 text-sm whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            {props.addText}
          </span>
        </span>
      ) : (
        <>
          <Plus className={props.sizeConfig.plusIconClass} />
          {props.showAddText ? <span className="text-sm">{props.addText}</span> : null}
        </>
      )}
    </Button>
  );
}

function OptionsList(props: {
  options: SocialAccountsPickerOption[];
  selectedIds: string[];
  disabled: boolean;
  searchPlaceholder: string;
  onToggle: (id: string) => void;
}) {
  return (
    <Command>
      <CommandInput placeholder={props.searchPlaceholder} />
      <CommandList>
        <CommandEmpty>No platforms found.</CommandEmpty>
        <CommandGroup>
          {props.options.map((option) => {
            const isSelected = props.selectedIds.includes(option.id);
            const optionDisabled = props.disabled || (Boolean(option.disabled) && !isSelected);
            const platformConfig = getPlatformConfig(option.platform);
            const platformLabel = platformConfig.displayName;
            const shortLabel = option.label?.trim() || '';
            const avatarName = option.avatarName?.trim() || shortLabel || platformLabel;
            const searchValue = `${platformLabel} ${shortLabel} ${avatarName}`.trim();

            return (
              <CommandItem
                key={option.id}
                value={searchValue}
                onSelect={() => props.onToggle(option.id)}
                disabled={optionDisabled}
                className="py-2"
              >
                <SocialAccountAvatar
                  platform={option.platform}
                  name={avatarName}
                  src={option.avatarUrl}
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
  );
}

interface AddAccountTriggerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: SocialAccountsPickerOption[];
  selectedIds: string[];
  disabled: boolean;
  addLabel: string;
  resolvedAddTooltip: string;
  addText: string;
  showAddText: boolean;
  revealAddTextOnHover: boolean;
  isInvalid: boolean;
  searchPlaceholder: string;
  sizeConfig: SocialAccountsPickerSizeConfig;
  onToggle: (id: string) => void;
}

export function AddAccountTrigger(props: AddAccountTriggerProps) {
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <PopoverTrigger asChild>
                <TriggerButton
                  disabled={props.disabled}
                  addLabel={props.addLabel}
                  addText={props.addText}
                  showAddText={props.showAddText}
                  revealAddTextOnHover={props.revealAddTextOnHover}
                  isInvalid={props.isInvalid}
                  sizeConfig={props.sizeConfig}
                />
              </PopoverTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-sm">{props.resolvedAddTooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent align="start" className="w-80 p-0">
        <OptionsList
          options={props.options}
          selectedIds={props.selectedIds}
          disabled={props.disabled}
          searchPlaceholder={props.searchPlaceholder}
          onToggle={props.onToggle}
        />
      </PopoverContent>
    </Popover>
  );
}
