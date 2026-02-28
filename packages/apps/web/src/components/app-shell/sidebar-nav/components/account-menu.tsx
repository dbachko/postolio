import type { Brand } from '@/lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Building2, LogOut, Shield } from 'lucide-react';

interface AccountMenuProps {
  userEmail: string;
  brands: Brand[];
  selectedBrand: Brand | null;
  revealClass: string;
  onBrandSelect: (brand: Brand) => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

function AccountMenuLabel({ userEmail }: { userEmail: string }) {
  return (
    <DropdownMenuLabel>
      <div className="flex flex-col space-y-1">
        <p className="text-sm leading-none font-medium">Account</p>
        <p className="text-muted-foreground text-xs leading-none">{userEmail}</p>
      </div>
    </DropdownMenuLabel>
  );
}

export function AccountMenu({
  userEmail,
  brands,
  selectedBrand,
  revealClass,
  onBrandSelect,
  onNavigate,
  onLogout,
}: AccountMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={cn(
            'flex w-full items-center justify-start gap-2 rounded-md p-2 text-sm transition-colors',
            'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          )}
        >
          <div className="bg-sidebar-primary flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full">
            <span className="text-sidebar-primary-foreground text-[10px] leading-none font-semibold">
              {selectedBrand?.name?.charAt(0) || userEmail.charAt(0).toUpperCase()}
            </span>
          </div>
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-left text-sm font-medium whitespace-nowrap',
              revealClass
            )}
          >
            {selectedBrand?.name ?? 'Account'}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" sideOffset={12} className="w-56">
        <AccountMenuLabel userEmail={userEmail} />
        <DropdownMenuSeparator />

        {brands.length > 0 && (
          <>
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              Switch Brand
            </DropdownMenuLabel>
            {brands.map((brand) => (
              <DropdownMenuItem
                key={brand.id}
                onClick={() => onBrandSelect(brand)}
                className={brand.id === selectedBrand?.id ? 'bg-accent font-medium' : ''}
              >
                <div className="flex w-full items-center justify-between">
                  <span>{brand.name}</span>
                  {brand.id === selectedBrand?.id && (
                    <span className="text-primary text-xs font-semibold">✓</span>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem onClick={() => onNavigate('/brands')}>
          <Building2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Manage Brands
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onNavigate('/settings/security')}>
          <Shield className="mr-2 h-4 w-4" aria-hidden="true" />
          Security
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} className="text-destructive">
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
