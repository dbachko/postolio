import type { Brand } from '@/lib/api';
import type { NavigationItem } from '../nav-config';

export interface SidebarNavProps {
  mainItems: NavigationItem[];
  secondaryItems: NavigationItem[];
  currentPath: string;
  userEmail: string | null;
  brands: Brand[];
  selectedBrand: Brand | null;
  onBrandSelect: (brand: Brand) => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}
