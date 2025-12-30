import { Button } from '@/components/ui/button';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';

type SidebarViewProfileButtonProps = {
  brandId: string;
};

export function SidebarViewProfileButton({ brandId }: SidebarViewProfileButtonProps) {
  const { openSidebar } = useRightSidebarRouter();
  return (
    <Button variant="outline" onClick={() => openSidebar('brand-profile', { id: brandId })}>
      View Profile
    </Button>
  );
}
