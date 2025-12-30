import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { NavigationItem } from '../nav-config';
import { Bell } from '@/components/notifications/bell';

interface LeftRailProps {
  mainItems: NavigationItem[];
  secondaryItems: NavigationItem[];
  isRouteActive: (item: NavigationItem) => boolean;
}

export function LeftRail({ mainItems, secondaryItems, isRouteActive }: LeftRailProps) {
  return (
    <aside className="bg-card flex w-16 flex-col items-center border-r py-3">
      {/* Logo / home (also acts as dashboard link) */}
      <Link
        to="/dashboard"
        className="flex h-10 w-10 items-center justify-center rounded-md"
        aria-label="Postolio home"
      >
        <img src="/postolio-icon.svg" alt="" className="h-7 w-7" aria-hidden="true" />
      </Link>

      <div className="mt-4 flex flex-1 flex-col items-center justify-between gap-4">
        <nav className="flex flex-col items-center gap-2">
          {mainItems.map((item) => {
            const active = isRouteActive(item);
            return (
              <Button
                asChild
                key={item.path}
                variant={active ? 'default' : 'ghost'}
                className={cn(
                  'flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] leading-tight',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
                aria-label={item.label}
              >
                <Link to={item.path}>
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                </Link>
              </Button>
            );
          })}
        </nav>

        <nav className="flex flex-col items-center gap-2">
          {secondaryItems.map((item) => {
            const active = isRouteActive(item);
            return (
              <Button
                asChild
                key={item.path}
                variant={active ? 'default' : 'ghost'}
                className={cn(
                  'flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] leading-tight',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
                aria-label={item.label}
              >
                <Link to={item.path}>
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                </Link>
              </Button>
            );
          })}

          {/* Notifications at the very bottom */}
          <div className="mt-2 flex flex-col items-center gap-1">
            <Bell />
          </div>
        </nav>
      </div>
    </aside>
  );
}
