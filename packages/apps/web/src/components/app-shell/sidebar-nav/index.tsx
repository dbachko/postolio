import { useEffect, useRef, useState, type UIEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import type { SidebarNavProps } from './types';
import { AccountMenu } from './components/account-menu';
import { AlertsButton } from './components/alerts-button';
import { SidebarNavigationItem } from './components/navigation-item';

function shouldForceOpenSection(path: string, currentPath: string): boolean {
  return currentPath === path || currentPath.startsWith(`${path}/`);
}

function getSectionOpenState(
  itemPath: string,
  currentPath: string,
  expandedParents: Record<string, boolean>
): boolean {
  const derivedOpen = expandedParents[itemPath];
  if (derivedOpen !== undefined) {
    return derivedOpen;
  }
  return shouldForceOpenSection(itemPath, currentPath);
}

function SidebarBrandHeader({
  isContentScrolled,
  revealClass,
}: {
  isContentScrolled: boolean;
  revealClass: string;
}) {
  return (
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
  );
}

function SidebarNavGroup({
  items,
  currentPath,
  revealClass,
  expandedParents,
  onToggleParent,
}: {
  items: SidebarNavProps['mainItems'];
  currentPath: string;
  revealClass: string;
  expandedParents: Record<string, boolean>;
  onToggleParent: (path: string) => void;
}) {
  return (
    <nav className="space-y-1 p-1">
      {items.map((item) => (
        <SidebarNavigationItem
          key={item.path}
          item={item}
          currentPath={currentPath}
          revealClass={revealClass}
          isOpen={getSectionOpenState(item.path, currentPath, expandedParents)}
          onToggle={onToggleParent}
        />
      ))}
    </nav>
  );
}

function SidebarNavAccountFooter({
  unreadCount,
  userEmail,
  brands,
  selectedBrand,
  revealClass,
  onBrandSelect,
  onNavigate,
  onLogout,
  onOpenNotifications,
}: {
  unreadCount: number;
  userEmail: SidebarNavProps['userEmail'];
  brands: SidebarNavProps['brands'];
  selectedBrand: SidebarNavProps['selectedBrand'];
  revealClass: string;
  onBrandSelect: SidebarNavProps['onBrandSelect'];
  onNavigate: SidebarNavProps['onNavigate'];
  onLogout: SidebarNavProps['onLogout'];
  onOpenNotifications: () => void;
}) {
  return (
    <SidebarFooter className="bg-sidebar border-sidebar-border sticky bottom-0 z-20 border-t p-2">
      <AlertsButton
        unreadCount={unreadCount}
        revealClass={revealClass}
        onClick={onOpenNotifications}
      />

      {userEmail ? (
        <AccountMenu
          userEmail={userEmail}
          brands={brands}
          selectedBrand={selectedBrand}
          revealClass={revealClass}
          onBrandSelect={onBrandSelect}
          onNavigate={onNavigate}
          onLogout={onLogout}
        />
      ) : null}
    </SidebarFooter>
  );
}

function useSidebarContentScroll() {
  const [isContentScrolled, setIsContentScrolled] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleContentScroll = (event: UIEvent<HTMLDivElement>) => {
    const { scrollTop } = event.currentTarget;
    const scrolled = scrollTop > 0;
    setIsContentScrolled((prev) => (prev === scrolled ? prev : scrolled));
  };

  return { isContentScrolled, contentRef, handleContentScroll };
}

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
  const { unreadCount } = useNotificationsStore();
  const { openSidebar } = useRightSidebarRouter();
  const { isContentScrolled, contentRef, handleContentScroll } = useSidebarContentScroll();

  useEffect(() => {
    void useNotificationsStore.getState().fetchLatest();
  }, []);

  const revealClass = cn('transition-opacity duration-200', 'opacity-0 group-hover:opacity-100');

  const toggleParent = (path: string) => {
    setExpandedParents((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  return (
    <aside
      className={cn(
        'bg-sidebar text-sidebar-foreground border-sidebar-border fixed inset-y-0 left-0 z-50 h-full w-[52px] border-r shadow-lg transition-[width] duration-300 ease-out hover:w-[225px]'
      )}
      aria-label="Primary navigation"
    >
      <div className="flex h-full min-h-0 flex-col">
        <SidebarBrandHeader isContentScrolled={isContentScrolled} revealClass={revealClass} />

        <SidebarContent ref={contentRef} onScroll={handleContentScroll} className="px-1">
          <SidebarGroup className="p-0">
            <SidebarNavGroup
              items={mainItems}
              currentPath={currentPath}
              revealClass={revealClass}
              expandedParents={expandedParents}
              onToggleParent={toggleParent}
            />
          </SidebarGroup>

          {secondaryItems.length > 0 && (
            <>
              <SidebarSeparator />
              <SidebarGroup className="p-0">
                <SidebarNavGroup
                  items={secondaryItems}
                  currentPath={currentPath}
                  revealClass={revealClass}
                  expandedParents={expandedParents}
                  onToggleParent={toggleParent}
                />
              </SidebarGroup>
            </>
          )}
        </SidebarContent>

        <SidebarNavAccountFooter
          unreadCount={unreadCount}
          userEmail={userEmail}
          brands={brands}
          selectedBrand={selectedBrand}
          revealClass={revealClass}
          onBrandSelect={onBrandSelect}
          onNavigate={onNavigate}
          onLogout={onLogout}
          onOpenNotifications={() => openSidebar('notifications')}
        />
      </div>
    </aside>
  );
}
