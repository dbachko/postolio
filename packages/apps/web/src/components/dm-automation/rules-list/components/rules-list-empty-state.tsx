import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type RulesListEmptyStateProps = {
  hasAnyRules: boolean;
  onCreate: () => void;
};

export function RulesListEmptyState({ hasAnyRules, onCreate }: RulesListEmptyStateProps) {
  return (
    <Card>
      <CardContent className="py-12">
        <div className="text-center">
          {hasAnyRules ? (
            <>
              <h3 className="mb-2 text-lg font-semibold">No rules found</h3>
              <p className="text-muted-foreground">Try adjusting your filters or search query.</p>
            </>
          ) : (
            <>
              <h3 className="mb-2 text-lg font-semibold">No automation rules yet</h3>
              <p className="text-muted-foreground mb-4">
                Create your first rule to start automating Instagram DM responses.
              </p>
              <Button onClick={onCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Rule
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
