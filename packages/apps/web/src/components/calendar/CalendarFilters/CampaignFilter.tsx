import { memo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCalendarFilterStore } from '../../../stores/calendarFilterStore';
import { campaign as campaignApi, type Campaign } from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';

interface CampaignFilterProps {
  brandId: string;
  compact?: boolean;
}

export const CampaignFilter = memo(({ brandId, compact = false }: CampaignFilterProps) => {
  const campaigns = useCalendarFilterStore((s) => s.campaigns);
  const setCampaigns = useCalendarFilterStore((s) => s.setCampaigns);
  const [isOpen, setIsOpen] = useState(false);

  const { data: campaignsData } = useQuery({
    queryKey: ['campaigns', brandId],
    queryFn: () => campaignApi.listCampaigns(brandId),
    staleTime: 5 * 60 * 1000,
  });

  const allCampaigns = (campaignsData?.campaigns || []) as Campaign[];

  const handleToggle = (campaignId: string) => {
    const cur = campaigns.slice();
    const idx = cur.indexOf(campaignId);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(campaignId);
    setCampaigns(cur);
  };

  return (
    <div>
      <Label className={`mb-1 text-xs ${compact ? 'sr-only' : ''}`}>Campaigns</Label>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size={compact ? 'sm' : 'default'}
            className={`w-full justify-start ${compact ? 'h-8 text-xs' : ''}`}
          >
            {campaigns.length === 0 ? 'All campaigns' : `${campaigns.length} selected`}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72">
          <div className="mb-2 flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setCampaigns([])}>
              Clear all
            </Button>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="campaign-none"
                checked={campaigns.includes('none')}
                onCheckedChange={() => handleToggle('none')}
              />
              <Label htmlFor="campaign-none" className="cursor-pointer font-normal">
                <span className="text-sm">No campaign</span>
              </Label>
            </div>
            {allCampaigns.map((c) => {
              const selected = campaigns.includes(c.id);
              return (
                <div key={c.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`campaign-${c.id}`}
                    checked={selected}
                    onCheckedChange={() => handleToggle(c.id)}
                  />
                  <Label
                    htmlFor={`campaign-${c.id}`}
                    className="flex cursor-pointer items-center gap-2 font-normal"
                  >
                    <span
                      aria-hidden
                      className="inline-block h-3.5 w-3.5 rounded-full border"
                      style={{ backgroundColor: (c as any).color || 'var(--muted)' }}
                    />
                    <span className="text-sm">{c.name}</span>
                  </Label>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
});
