import { useEffect } from 'react';
import { Bell as BellIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { NotificationsDropdown } from './NotificationsDropdown';

export function Bell() {
  const { unreadCount, isOpen, setOpen, fetchLatest } = useNotificationsStore();

  useEffect(() => {
    // Initial fetch when bell mounts
    void fetchLatest();
  }, [fetchLatest]);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        className="relative h-9 w-9 p-0"
        aria-label="Open notifications"
        onClick={() => setOpen(!isOpen)}
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="bg-primary text-primary-foreground absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-[10px] font-medium">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>
      {isOpen && <NotificationsDropdown />}
    </div>
  );
}
