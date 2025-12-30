import { Lightbulb } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function TipsCard() {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 pt-6 text-sm">
        <Lightbulb className="mt-0.5 h-4 w-4" />
        <div>
          <div className="font-medium">Tips</div>
          <p>
            Your strategy is automatically generated based on your campaign goals and timeline. You
            can manually edit content pillars (add, remove, or adjust percentages) to fine-tune your
            campaign before continuing.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
