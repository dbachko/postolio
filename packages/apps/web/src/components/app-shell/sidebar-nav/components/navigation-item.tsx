import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';

import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

import { type NavigationItem, isRouteActive } from '../../nav-config';
import { getSectionNavItems } from '../../section-nav';

function getActiveChildPath(item: NavigationItem, currentPath: string): string | null {
  const children = getSectionNavItems(item);
  if (children.length === 0) {
    return null;
  }
  return (
    children
      .filter((child) => currentPath === child.path || currentPath.startsWith(`${child.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0]?.path ?? null
  );
}

function getRowClass(isActive: boolean): string {
  return cn(
    'flex w-full items-center justify-start gap-2 rounded-md p-2 text-sm transition-colors',
    isActive
      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
  );
}

function SidebarNavLabel({ label, revealClass }: { label: string; revealClass: string }) {
  return (
    <span
      className={cn(
        'min-w-0 flex-1 truncate text-left text-sm font-medium whitespace-nowrap',
        revealClass
      )}
    >
      {label}
    </span>
  );
}

function SidebarNavChildren({
  item,
  activeChildPath,
  isOpen,
  revealClass,
}: {
  item: NavigationItem;
  activeChildPath: string | null;
  isOpen: boolean;
  revealClass: string;
}) {
  const children = getSectionNavItems(item);
  if (!children.length) {
    return null;
  }

  return (
    <div
      className={cn(
        'mt-0 overflow-hidden transition-[max-height,opacity,margin-top] duration-200 ease-out',
        isOpen
          ? 'max-h-0 opacity-0 group-hover:mt-1 group-hover:max-h-64 group-hover:opacity-100'
          : 'max-h-0 opacity-0'
      )}
    >
      <SidebarMenuSub>
        {children.map((child) => (
          <SidebarMenuSubItem key={child.path}>
            <SidebarMenuSubButton asChild isActive={activeChildPath === child.path}>
              <Link to={child.path}>
                {child.icon && <child.icon aria-hidden="true" />}
                <span className={cn('min-w-0 flex-1 truncate whitespace-nowrap', revealClass)}>
                  {child.label}
                </span>
              </Link>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    </div>
  );
}

export function SidebarNavigationItem({
  item,
  currentPath,
  revealClass,
  isOpen,
  onToggle,
}: {
  item: NavigationItem;
  currentPath: string;
  revealClass: string;
  isOpen: boolean;
  onToggle: (path: string) => void;
}) {
  const children = getSectionNavItems(item);
  const hasChildren = children.length > 0;
  const activeChildPath = getActiveChildPath(item, currentPath);
  const isActive = isRouteActive(item, currentPath) || activeChildPath !== null;
  const rowClass = getRowClass(isActive);

  return (
    <div key={item.path} className="space-y-0">
      <div className="relative">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(item.path)}
            className={rowClass}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${item.label} submenu`}
          >
            <item.icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
            <SidebarNavLabel label={item.label} revealClass={revealClass} />
          </button>
        ) : (
          <Link
            to={item.path}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            className={rowClass}
          >
            <item.icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
            <SidebarNavLabel label={item.label} revealClass={revealClass} />
          </Link>
        )}

        {hasChildren ? (
          <ChevronDown
            className={cn(
              'pointer-events-none absolute top-1/2 right-1 h-4 w-4 -translate-y-1/2 transition-transform duration-200',
              isOpen ? 'rotate-0' : '-rotate-90',
              revealClass
            )}
            aria-hidden="true"
          />
        ) : null}
      </div>

      <SidebarNavChildren
        item={item}
        activeChildPath={activeChildPath}
        isOpen={isOpen}
        revealClass={revealClass}
      />
    </div>
  );
}
