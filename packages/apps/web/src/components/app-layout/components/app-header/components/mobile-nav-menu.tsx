import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Building2, Grid3X3, Home } from 'lucide-react';

import {
  isRouteActive as isRouteActiveForItem,
  mainNavItems,
  secondaryNavItems,
  type NavigationItem,
} from '@/components/app-shell/nav-config';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function MobileNavMenu() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isActiveRoute = useCallback(
    (item: NavigationItem) => {
      return isRouteActiveForItem(item, location.pathname);
    },
    [location.pathname]
  );

  useEffect(() => {
    setOpen(false);
  }, [location]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative sm:-ml-2 md:hidden" ref={menuRef}>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="More navigation options"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Grid3X3 className="h-5 w-5" aria-hidden="true" />
      </Button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/20 md:hidden"
            onClick={() => setOpen(false)}
          />
          <div className="bg-card absolute right-0 z-40 mt-2 w-80 rounded-lg border shadow-lg">
            <div className="p-4">
              <div className="mb-4">
                <div className="space-y-1">
                  {mainNavItems.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center rounded-lg px-3 py-2 text-sm transition-colors',
                        isActiveRoute(item)
                          ? 'bg-accent text-primary'
                          : 'hover:bg-accent hover:text-accent-foreground'
                      )}
                    >
                      <item.icon className="mr-3 h-5 w-5" aria-hidden="true" />
                      <div>
                        <div className="font-medium">{item.label}</div>
                        {item.description && (
                          <div className="text-muted-foreground text-xs">{item.description}</div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="space-y-1 border-t pt-4">
                <Link
                  to="/dashboard"
                  onClick={() => setOpen(false)}
                  className="hover:bg-accent flex items-center rounded-lg px-3 py-2 text-sm transition-colors"
                >
                  <Home className="mr-3 h-4 w-4" aria-hidden="true" />
                  Dashboard
                </Link>
                <Link
                  to="/brands"
                  onClick={() => setOpen(false)}
                  className="hover:bg-accent flex items-center rounded-lg px-3 py-2 text-sm transition-colors"
                >
                  <Building2 className="mr-3 h-4 w-4" aria-hidden="true" />
                  Manage Brands
                </Link>
                {secondaryNavItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setOpen(false)}
                    className="hover:bg-accent flex items-center rounded-lg px-3 py-2 text-sm transition-colors"
                  >
                    <item.icon className="mr-3 h-4 w-4" aria-hidden="true" />
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
