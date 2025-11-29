import { campaignTypes } from '../../../constants/campaign-types';
import { CampaignTypeCard } from '../shared/CampaignTypeCard';
import { useCampaignWizard } from '../../../hooks/useCampaignWizard';
import { useBrandTimezone } from '../../../hooks/useBrandTimezone';

export function Step1TypeSelection() {
  const { campaignType, loadDefaultsFromType, nextStep } = useCampaignWizard();
  const { brandTimezone } = useBrandTimezone();

  const onSelect = (id: string) => {
    const cfg = campaignTypes.find((c) => c.id === id)!;
    loadDefaultsFromType(cfg, { timezone: brandTimezone });
    nextStep();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Choose a campaign type</h2>
        <p className="text-muted-foreground text-sm">
          We’ll prefill smart defaults based on your choice.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {campaignTypes.map((t) => (
          <CampaignTypeCard
            key={t.id}
            type={t}
            selected={campaignType === t.id}
            onSelect={() => onSelect(t.id)}
          />
        ))}
      </div>
    </div>
  );
}
