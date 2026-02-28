import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { getPlatformConfig } from '@/lib/platform-config';
import { cn } from '@/lib/utils';
import type { ProfileAvatarProps } from '@/components/ui/profile-avatar';

import type { SocialAccountsPickerSizeConfig } from '../constants';
import type { SocialAccountsPickerOption } from '../types';

interface SelectedAccountAvatarsProps {
  selectedOptions: SocialAccountsPickerOption[];
  size: NonNullable<ProfileAvatarProps['size']>;
  sizeConfig: SocialAccountsPickerSizeConfig;
  disabled: boolean;
  onToggle: (id: string) => void;
}

export function SelectedAccountAvatars(props: SelectedAccountAvatarsProps) {
  return (
    <>
      {props.selectedOptions.map((option) => {
        const platformConfig = getPlatformConfig(option.platform);
        const platformLabel = platformConfig.displayName;
        const shortLabel = option.label?.trim() || '';
        const tooltipLabel =
          option.tooltipLabel?.trim() ||
          (shortLabel ? `${platformLabel} · ${shortLabel}` : platformLabel);
        const avatarName = option.avatarName?.trim() || shortLabel || platformLabel;

        return (
          <Tooltip key={option.id}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  'inline-flex items-center justify-center rounded-full p-0',
                  props.sizeConfig.triggerBoxClass,
                  !props.disabled && 'cursor-pointer',
                  props.disabled && 'cursor-not-allowed'
                )}
                onClick={() => props.onToggle(option.id)}
                disabled={props.disabled}
                aria-label={`Remove ${tooltipLabel}`}
              >
                <SocialAccountAvatar
                  platform={option.platform}
                  name={avatarName}
                  src={option.avatarUrl}
                  size={props.size}
                  selected
                  disabled={props.disabled}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-sm">{tooltipLabel}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </>
  );
}
