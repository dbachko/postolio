import { useEffect, useRef, useState, type UIEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { ChevronDown } from 'lucide-react';
import { type NavigationItem, isRouteActive } from '../nav-config';
import { getSectionNavItems } from '../section-nav';
import type { SidebarNavProps } from './types';
import { AccountMenu } from './components/account-menu';
import { AlertsButton } from './components/alerts-button';

export function SidebarNav({
  mainItems,
  secondaryItems,
  currentPath,
  userEmail,
  brands,
  selectedBrand,
  onBrandSelect,
  onNavigate,
  onLogout,
}: SidebarNavProps) {
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});
  const [isContentScrolled, setIsContentScrolled] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { unreadCount, fetchLatest } = useNotificationsStore();
  const { openSidebar } = useRightSidebarRouter();

  useEffect(() => {
    void fetchLatest();
  }, [fetchLatest]);

  const revealClass = cn('transition-opacity duration-200', 'opacity-0 group-hover:opacity-100');

  const handleContentScroll = (event: UIEvent<HTMLDivElement>) => {
    const { scrollTop } = event.currentTarget;
    const scrolled = scrollTop > 0;
    setIsContentScrolled((prev) => (prev === scrolled ? prev : scrolled));
  };

  useEffect(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    const { scrollTop } = el;
    setIsContentScrolled(scrollTop > 0);
  }, [currentPath, mainItems, secondaryItems]);

  const toggleParent = (path: string) => {
    setExpandedParents((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const renderItem = (item: NavigationItem) => {
    const children = getSectionNavItems(item);
    const hasChildren = children.length > 0;
    const activeChildPath = hasChildren
      ? (children
          .filter((child) => currentPath === child.path || currentPath.startsWith(`${child.path}/`))
          .sort((a, b) => b.path.length - a.path.length)[0]?.path ?? null)
      : null;
    const childrenActive = activeChildPath !== null;
    const active = isRouteActive(item, currentPath) || childrenActive;

    const forcedOpen =
      childrenActive || currentPath === item.path || currentPath.startsWith(`${item.path}/`);
    const derivedOpen = expandedParents[item.path];
    const isOpen = derivedOpen !== undefined ? derivedOpen : forcedOpen;

    const rowClass = cn(
      'flex w-full items-center gap-2 justify-start rounded-md p-2 text-sm transition-colors',
      active
        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
    );

    return (
      <div key={item.path} className="space-y-0">
        <div className="relative">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleParent(item.path)}
              className={rowClass}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${item.label} submenu`}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-left text-sm font-medium whitespace-nowrap',
                  revealClass
                )}
              >
                {item.label}
              </span>
            </button>
          ) : (
            <Link
              to={item.path}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={rowClass}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-left text-sm font-medium whitespace-nowrap',
                  revealClass
                )}
              >
                {item.label}
              </span>
            </Link>
          )}

          {hasChildren && (
            <ChevronDown
              className={cn(
                'pointer-events-none absolute top-1/2 right-1 h-4 w-4 -translate-y-1/2 transition-transform duration-200',
                isOpen ? 'rotate-0' : '-rotate-90',
                revealClass
              )}
              aria-hidden="true"
            />
          )}
        </div>

        {hasChildren && (
          <div
            className={cn(
              'mt-0 overflow-hidden transition-[max-height,opacity,margin-top] duration-200 ease-out',
              isOpen
                ? 'max-h-0 opacity-0 group-hover:mt-1 group-hover:max-h-64 group-hover:opacity-100'
                : 'max-h-0 opacity-0'
            )}
          >
            <SidebarMenuSub>
              {children.map((child) => {
                const childActive = activeChildPath === child.path;
                return (
                  <SidebarMenuSubItem key={child.path}>
                    <SidebarMenuSubButton asChild isActive={childActive}>
                      <Link to={child.path}>
                        {child.icon && <child.icon aria-hidden="true" />}
                        <span
                          className={cn('min-w-0 flex-1 truncate whitespace-nowrap', revealClass)}
                        >
                          {child.label}
                        </span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                );
              })}
            </SidebarMenuSub>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      className={cn(
        'bg-sidebar text-sidebar-foreground border-sidebar-border fixed inset-y-0 left-0 z-50 h-full w-[52px] border-r shadow-lg transition-[width] duration-300 ease-out hover:w-[225px]'
      )}
      aria-label="Primary navigation"
    >
      <div className="flex h-full min-h-0 flex-col">
        <SidebarHeader
          className={cn(
            'bg-sidebar sticky top-0 z-20 p-2',
            isContentScrolled && 'border-sidebar-border border-b shadow-sm'
          )}
        >
          <Link
            to="/dashboard"
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center justify-start gap-2 rounded-md p-2 text-sm font-medium transition-colors"
            aria-label="Dashboard"
          >
            <img
              src="/postolio-icon.svg"
              alt=""
              className="block h-5 min-h-5 w-5 min-w-5 flex-shrink-0"
              aria-hidden="true"
            />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-left text-sm font-semibold whitespace-nowrap',
                revealClass
              )}
            >
              Postolio
            </span>
          </Link>
        </SidebarHeader>

        <SidebarContent ref={contentRef} onScroll={handleContentScroll} className="px-1">
          <SidebarGroup className="p-0">
            <nav className="space-y-1 p-1">{mainItems.map(renderItem)}</nav>
          </SidebarGroup>

          {secondaryItems.length > 0 && (
            <>
              <SidebarSeparator />
              <SidebarGroup className="p-0">
                <nav className="space-y-1 p-1">{secondaryItems.map(renderItem)}</nav>
              </SidebarGroup>
            </>
          )}
        </SidebarContent>

        <SidebarFooter className="bg-sidebar border-sidebar-border sticky bottom-0 z-20 border-t p-2">
          <AlertsButton
            unreadCount={unreadCount}
            revealClass={revealClass}
            onClick={() => openSidebar('notifications')}
          />

          {userEmail && (
            <AccountMenu
              userEmail={userEmail}
              brands={brands}
              selectedBrand={selectedBrand}
              revealClass={revealClass}
              onBrandSelect={onBrandSelect}
              onNavigate={onNavigate}
              onLogout={onLogout}
            />
          )}
        </SidebarFooter>
      </div>
    </aside>
  );
}
