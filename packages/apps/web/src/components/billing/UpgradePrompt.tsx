import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type UpgradePromptProps = {
  title?: string;
  description?: string;
  ctaLabel?: string;
  to?: string;
};

export function UpgradePrompt({
  title = 'Upgrade to Pro',
  description = 'Unlock higher limits, billing controls, and more AI capacity.',
  ctaLabel = 'See pricing',
  to = '/pricing',
}: UpgradePromptProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to={to} className="inline-flex items-center gap-2">
            {ctaLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default UpgradePrompt;
