import { useBrandStore } from '../stores/brandStore';
import { ContentCalendar } from '../components/ContentCalendar';
import { AppEmptyState } from '@/components/AppEmptyState';

export function Content() {
  const { selectedBrand } = useBrandStore();

  if (!selectedBrand) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AppEmptyState
          variant="minimal"
          title="Select a brand to view the content calendar"
          description="Choose which brand you want to plan content for to unlock scheduling, drafts, and automation."
          actions={[{ label: 'Choose Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  return <ContentCalendar brandId={selectedBrand.id} brandName={selectedBrand.name} />;
}
