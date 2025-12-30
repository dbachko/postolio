import { Card, CardContent } from '@/components/ui/card';

export function RulesListLoading() {
  return (
    <Card>
      <CardContent className="py-8">
        <div className="flex items-center justify-center">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2" />
        </div>
      </CardContent>
    </Card>
  );
}
