import { AppEmptyState } from '@/components/app-empty-state';

import { SkillsPageContent } from './skills/skills-page-content';
import { useSkillsPageModel } from './skills/use-skills-page-model';

export function Skills() {
  const model = useSkillsPageModel();

  if (!model.selectedBrand) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AppEmptyState
          variant="minimal"
          title="Select a brand to manage skills"
          description="Choose which brand you want to configure."
          actions={[{ label: 'Choose Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  return <SkillsPageContent model={model} />;
}
