import { Bell as BellIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AlertsButtonProps {
  unreadCount: number;
  revealClass: string;
  onClick: () => void;
}

export function AlertsButton({ unreadCount, revealClass, onClick }: AlertsButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open notifications"
      className={cn(
        'flex w-full items-center justify-start gap-2 rounded-md p-2 text-sm transition-colors',
        'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
      )}
    >
      <div className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center">
        <BellIcon className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="bg-sidebar-primary text-sidebar-primary-foreground absolute -top-1 -right-1 grid h-4 min-w-[16px] place-items-center rounded-full px-0.5 text-[9px] font-medium">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </div>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-left text-sm font-medium whitespace-nowrap',
          revealClass
        )}
      >
        Alerts
      </span>
    </button>
  );
}
