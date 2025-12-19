import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { CampaignTypeConfig } from '../../../types/campaign-wizard';

interface Props {
  type: CampaignTypeConfig;
  selected: boolean;
  onSelect: () => void;
}

export function CampaignTypeCard({ type, selected, onSelect }: Props) {
  return (
    <Card
      onClick={onSelect}
      className={`cursor-pointer transition-transform ${selected ? 'ring-primary ring-2' : 'hover:scale-[1.01]'} `}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-xl">{type.icon}</span>
          {type.name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{type.description}</p>
      </CardContent>
    </Card>
  );
}
