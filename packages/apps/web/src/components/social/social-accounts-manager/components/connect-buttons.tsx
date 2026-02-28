import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Link2, Loader2, Plus } from 'lucide-react';
import { FacebookIcon, InstagramIcon } from '@/components/icons/brand-icons';
import type { CSSProperties, ReactNode } from 'react';
import type { ConnectIntent } from '../types';

type ConnectButtonsProps = {
  actionLabel: string;
  isConnecting: boolean;
  connectingIntent: ConnectIntent | null;
  isPending: boolean;
  instagramColor: string;
  facebookColor: string;
  showInstagram?: boolean;
  showFacebook?: boolean;
  onConnectInstagram: () => void;
  onConnectFacebook: () => void;
};

interface ConnectPlatformButtonProps {
  tooltip: string;
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
  style: CSSProperties;
  isLoading: boolean;
  icon: ReactNode;
  label: string;
}

function ConnectPlatformButton({
  tooltip,
  ariaLabel,
  disabled,
  onClick,
  style,
  isLoading,
  icon,
  label,
}: ConnectPlatformButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={ariaLabel}
          onClick={onClick}
          disabled={disabled}
          className="hover:opacity-90"
          style={style}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
          <span className="hidden sm:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function ConnectButtons({
  actionLabel,
  isConnecting,
  connectingIntent,
  isPending,
  instagramColor,
  facebookColor,
  showInstagram = true,
  showFacebook = true,
  onConnectInstagram,
  onConnectFacebook,
}: ConnectButtonsProps) {
  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="text-muted-foreground flex w-full items-center gap-1 text-xs font-medium sm:w-auto">
          {actionLabel === 'Add' ? (
            <Plus className="h-3.5 w-3.5" />
          ) : (
            <Link2 className="h-3.5 w-3.5" />
          )}
          {actionLabel}
        </div>
        {showInstagram ? (
          <ConnectPlatformButton
            tooltip="Connect Instagram (Business/Creator)"
            ariaLabel="Connect Instagram accounts"
            onClick={onConnectInstagram}
            disabled={isPending || isConnecting}
            style={{
              backgroundColor: instagramColor,
              backgroundImage:
                'linear-gradient(45deg, #feda75 0%, #fa7e1e 25%, #d62976 50%, #962fbf 75%, #4f5bd5 100%)',
              borderColor: instagramColor,
              color: 'white',
            }}
            isLoading={connectingIntent === 'instagram' && isConnecting}
            icon={<InstagramIcon className="h-4 w-4" aria-hidden="true" />}
            label="Instagram"
          />
        ) : null}

        {showFacebook ? (
          <ConnectPlatformButton
            tooltip="Connect Facebook (Pages)"
            ariaLabel="Connect Facebook Pages"
            onClick={onConnectFacebook}
            disabled={isPending || isConnecting}
            style={{
              backgroundColor: facebookColor,
              borderColor: facebookColor,
              color: 'white',
            }}
            isLoading={connectingIntent === 'facebook' && isConnecting}
            icon={<FacebookIcon className="h-4 w-4" aria-hidden="true" />}
            label="Facebook"
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}
