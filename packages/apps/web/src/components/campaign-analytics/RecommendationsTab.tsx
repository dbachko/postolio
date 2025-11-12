import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lightbulb, Loader2 } from 'lucide-react';

interface Recommendation {
  priority: string;
  type: string;
  message: string;
  impact: string;
  actionable: boolean;
}

interface RecommendationsTabProps {
  recommendations: Recommendation[];
  isLoading: boolean;
}

export function RecommendationsTab({ recommendations, isLoading }: RecommendationsTabProps) {
  const getPriorityVariant = (priority: string): 'default' | 'secondary' | 'destructive' => {
    const p = String(priority).toLowerCase();
    if (p === 'high') return 'destructive';
    if (p === 'medium') return 'default';
    return 'secondary';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5" />
          Optimization Recommendations
        </CardTitle>
        <CardDescription>AI-powered insights to improve your campaign performance</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading recommendations...
          </div>
        ) : recommendations.length === 0 ? (
          <div className="py-8 text-center">
            <Lightbulb className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <h3 className="mb-2 font-medium">No recommendations yet</h3>
            <p className="text-muted-foreground">
              We'll provide optimization insights once your campaign has more data.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {recommendations.map((rec, index) => (
              <Card
                key={index}
                className="border-l-4"
                style={{ borderLeftColor: 'hsl(var(--info))' }}
              >
                <CardContent className="p-4">
                  <div className="mb-2 flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={getPriorityVariant(rec.priority)}>
                        {rec.priority} priority
                      </Badge>
                      <Badge variant="outline">{rec.type}</Badge>
                    </div>
                  </div>
                  <p className="mb-2 text-sm font-medium">{rec.message}</p>
                  <p className="text-muted-foreground mb-3 text-xs">
                    Expected impact: {rec.impact}
                  </p>
                  {rec.actionable && (
                    <Button size="sm" variant="outline">
                      Take Action
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
