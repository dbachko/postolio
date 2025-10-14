import { campaignTypes } from '../../../constants/campaign-types';
import { CampaignTypeCard } from '../shared/CampaignTypeCard';
import { useCampaignWizard } from '../../../hooks/useCampaignWizard';
import { Button } from '../../ui/button';

export function Step1TypeSelection() {
  const { campaignType, setCampaignType, loadDefaultsFromType, nextStep } = useCampaignWizard();

  const onSelect = (id: string) => {
    const cfg = campaignTypes.find((c) => c.id === id)!;
    setCampaignType(cfg.id);
    loadDefaultsFromType(cfg);
  };

  const selectedCfg = campaignTypes.find((c) => c.id === campaignType);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Choose a campaign type</h2>
        <p className="text-sm text-gray-600">We’ll prefill smart defaults based on your choice.</p>
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

      <div className="flex justify-end">
        <Button onClick={nextStep} disabled={!selectedCfg}>
          Continue
        </Button>
      </div>
    </div>
  );
}
