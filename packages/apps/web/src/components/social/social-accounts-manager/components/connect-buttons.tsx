import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Link2, Loader2, Plus } from 'lucide-react';
import { FacebookIcon, InstagramIcon } from '@/components/icons/brand-icons';
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-label="Connect Instagram accounts"
                onClick={onConnectInstagram}
                disabled={isPending || isConnecting}
                className="hover:opacity-90"
                style={{
                  backgroundColor: instagramColor,
                  backgroundImage:
                    'linear-gradient(45deg, #feda75 0%, #fa7e1e 25%, #d62976 50%, #962fbf 75%, #4f5bd5 100%)',
                  borderColor: instagramColor,
                  color: 'white',
                }}
              >
                {connectingIntent === 'instagram' && isConnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <InstagramIcon className="h-4 w-4" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">Instagram</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Connect Instagram (Business/Creator)</TooltipContent>
          </Tooltip>
        ) : null}

        {showFacebook ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-label="Connect Facebook Pages"
                onClick={onConnectFacebook}
                disabled={isPending || isConnecting}
                className="hover:opacity-90"
                style={{
                  backgroundColor: facebookColor,
                  borderColor: facebookColor,
                  color: 'white',
                }}
              >
                {connectingIntent === 'facebook' && isConnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FacebookIcon className="h-4 w-4" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">Facebook</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Connect Facebook (Pages)</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
