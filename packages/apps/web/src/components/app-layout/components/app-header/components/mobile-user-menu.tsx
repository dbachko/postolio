import type { Brand } from '@/lib/api';
import { Building2, LogOut, Shield } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type MobileUserMenuProps = {
  userEmail: string;
  brands: Brand[];
  selectedBrand: Brand | null;
  onSelectBrand: (brand: Brand) => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
};

export function MobileUserMenu({
  userEmail,
  brands,
  selectedBrand,
  onSelectBrand,
  onNavigate,
  onLogout,
}: MobileUserMenuProps) {
  const fallbackInitial = userEmail ? userEmail.charAt(0).toUpperCase() : '?';

  return (
    <div className="md:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="flex h-9 w-9 shrink-0 items-center justify-center p-0"
            aria-label="User and brand menu"
          >
            <div className="bg-primary flex h-7 w-7 items-center justify-center rounded-full">
              <span className="text-primary-foreground text-xs font-semibold">
                {selectedBrand?.name?.charAt(0) || fallbackInitial}
              </span>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col space-y-1">
              <p className="text-sm leading-none font-medium">Account</p>
              <p className="text-muted-foreground text-xs leading-none">{userEmail}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {brands.length > 0 && (
            <>
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                Switch Brand
              </DropdownMenuLabel>
              {brands.map((brand) => (
                <DropdownMenuItem
                  key={brand.id}
                  onClick={() => onSelectBrand(brand)}
                  className={selectedBrand?.id === brand.id ? 'bg-accent font-medium' : ''}
                >
                  <div className="flex w-full items-center justify-between">
                    <span>{brand.name}</span>
                    {selectedBrand?.id === brand.id && <CheckmarkIcon />}
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
          <DropdownMenuItem onClick={() => onNavigate('/security')}>
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
    </div>
  );
}

function CheckmarkIcon() {
  return <span className="text-primary text-xs font-semibold">✓</span>;
}
