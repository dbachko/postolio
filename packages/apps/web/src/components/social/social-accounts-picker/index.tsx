import { useMemo, useState } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { SOCIAL_ACCOUNTS_PICKER_SIZE_CONFIG } from './constants';
import { AddAccountTrigger } from './components/add-account-trigger';
import { SelectedAccountAvatars } from './components/selected-account-avatars';
import type { SocialAccountsPickerOption, SocialAccountsPickerProps } from './types';

function useSelectedOptions(options: SocialAccountsPickerOption[], value: string[]) {
  return useMemo(() => {
    const byId = new Map(options.map((option) => [option.id, option]));
    return value.map((id) => byId.get(id)).filter(Boolean) as SocialAccountsPickerOption[];
  }, [options, value]);
}

function useToggleSelection(args: {
  options: SocialAccountsPickerOption[];
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  return (id: string) => {
    if (args.disabled) {
      return;
    }

    const option = args.options.find((item) => item.id === id);
    const isSelected = args.value.includes(id);
    if (!option || (option.disabled && !isSelected)) {
      return;
    }

    const next = new Set(args.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    args.onChange(Array.from(next));
  };
}

function PickerLayout(props: {
  selectedLayout: NonNullable<SocialAccountsPickerProps['selectedLayout']>;
  className?: string;
  selectedAccounts: React.ReactNode;
  addTrigger: React.ReactNode;
  triggerBoxHeightClass: string;
}) {
  if (props.selectedLayout === 'scroll') {
    return (
      <div className={cn('flex items-center gap-2', props.className)}>
        <div
          className={cn(
            'flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto overflow-y-visible pr-1',
            props.triggerBoxHeightClass
          )}
        >
          {props.selectedAccounts}
        </div>
        {props.addTrigger}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', props.className)}>
      {props.selectedAccounts}
      {props.addTrigger}
    </div>
  );
}

function getAddTriggerState(args: {
  addTooltip?: string;
  addButtonText?: string;
  addButtonTextMode: NonNullable<SocialAccountsPickerProps['addButtonTextMode']>;
  required: boolean;
  disabled: boolean;
  selectedCount: number;
}) {
  const addText = args.addButtonText?.trim() || '';
  const resolvedAddTooltip = (args.addTooltip?.trim() || 'Add destination').trim();
  const showRequired = args.required && !args.disabled;
  const showAddText = Boolean(addText);

  return {
    addText,
    resolvedAddTooltip,
    isInvalid: showRequired && args.selectedCount === 0,
    showAddText,
    revealAddTextOnHover: showAddText && args.addButtonTextMode === 'hover',
  };
}

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
  const addTriggerState = getAddTriggerState({
    addTooltip,
    addButtonText,
    addButtonTextMode,
    required,
    disabled,
    selectedCount: value.length,
  });
  const sizeConfig =
    SOCIAL_ACCOUNTS_PICKER_SIZE_CONFIG[size] || SOCIAL_ACCOUNTS_PICKER_SIZE_CONFIG.md;
  const selectedOptions = useSelectedOptions(options, value);
  const toggle = useToggleSelection({ options, value, disabled, onChange });

  const selectedAccounts = (
    <TooltipProvider>
      <SelectedAccountAvatars
        selectedOptions={selectedOptions}
        size={size}
        sizeConfig={sizeConfig}
        disabled={disabled}
        onToggle={toggle}
      />
    </TooltipProvider>
  );

  const addTrigger = (
    <AddAccountTrigger
      open={open}
      onOpenChange={setOpen}
      options={options}
      selectedIds={value}
      disabled={disabled}
      addLabel={addLabel}
      resolvedAddTooltip={addTriggerState.resolvedAddTooltip}
      addText={addTriggerState.addText}
      showAddText={addTriggerState.showAddText}
      revealAddTextOnHover={addTriggerState.revealAddTextOnHover}
      isInvalid={addTriggerState.isInvalid}
      searchPlaceholder={searchPlaceholder}
      sizeConfig={sizeConfig}
      onToggle={toggle}
    />
  );

  return (
    <PickerLayout
      selectedLayout={selectedLayout}
      className={className}
      selectedAccounts={selectedAccounts}
      addTrigger={addTrigger}
      triggerBoxHeightClass={sizeConfig.triggerBoxHeightClass}
    />
  );
}
