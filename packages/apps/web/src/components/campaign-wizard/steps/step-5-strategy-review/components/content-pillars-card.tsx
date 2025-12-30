import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PillarDraft } from '../types';

interface ContentPillarsCardProps {
  pillars: PillarDraft[];
  total: number;
  onSetName: (index: number, name: string) => void;
  onSetPercentage: (index: number, percentage: number) => void;
  onAddPillar: () => void;
  onRemovePillar: (index: number) => void;
  onLearnMore: () => void;
}

export function ContentPillarsCard({
  pillars,
  total,
  onSetName,
  onSetPercentage,
  onAddPillar,
  onRemovePillar,
  onLearnMore,
}: ContentPillarsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Content Pillars</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {pillars.map((p, idx) => (
          <div key={idx} className="grid grid-cols-5 items-end gap-2">
            <div className="col-span-3 space-y-1">
              <Label>Pillar Name</Label>
              <Input value={p.name} onChange={(e) => onSetName(idx, e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Percentage</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={p.percentage}
                onChange={(e) => onSetPercentage(idx, Number(e.target.value))}
              />
            </div>
            {pillars.length > 1 && (
              <div className="col-span-5">
                <Button variant="ghost" size="sm" onClick={() => onRemovePillar(idx)}>
                  Remove
                </Button>
              </div>
            )}
          </div>
        ))}
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <Button variant="outline" size="sm" onClick={onAddPillar}>
            Add Pillar
          </Button>
          <div className="flex items-center gap-3">
            <Button variant="link" className="h-auto px-0" onClick={onLearnMore}>
              Learn more
            </Button>
            <span className={total !== 100 ? 'text-destructive' : ''}>Total: {total}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
