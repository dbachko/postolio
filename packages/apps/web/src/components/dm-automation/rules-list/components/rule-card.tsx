import { Archive, Pause, Pencil, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DMAutomationRule } from '@/lib/api';

type RuleCardProps = {
  rule: DMAutomationRule;
  onToggleStatus: (rule: DMAutomationRule) => void;
  onEdit: (rule: DMAutomationRule) => void;
  onArchive: (rule: DMAutomationRule) => void;
};

export function RuleCard({ rule, onToggleStatus, onEdit, onArchive }: RuleCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {rule.name}
              <Badge variant={rule.status === 'active' ? 'default' : 'secondary'}>
                {rule.status}
              </Badge>
            </CardTitle>
            <div className="text-muted-foreground mt-2 space-y-1 text-sm">
              <div>
                <span className="font-medium">Trigger:</span> {rule.triggerType.replace('_', ' ')}
                {rule.triggerConfig.keywords.length > 0 &&
                  ` (${rule.triggerConfig.matchType} match)`}
              </div>
              {rule.triggerConfig.keywords.length > 0 ? (
                <div>
                  <span className="font-medium">Keywords:</span>{' '}
                  {rule.triggerConfig.keywords.join(', ')}
                </div>
              ) : null}
              <div>
                <span className="font-medium">Action:</span> {rule.actionType.replace('_', ' ')}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onToggleStatus(rule)}
              title={rule.status === 'active' ? 'Pause rule' : 'Activate rule'}
            >
              {rule.status === 'active' ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <Button size="icon" variant="ghost" onClick={() => onEdit(rule)} title="Edit rule">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onArchive(rule)}
              title="Archive rule"
            >
              <Archive className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-2">
          {rule.messageTemplate ? (
            <div>
              <p className="mb-1 text-sm font-medium">Message Template:</p>
              <p className="text-muted-foreground bg-muted rounded p-2 text-sm">
                {rule.messageTemplate}
              </p>
            </div>
          ) : null}
          {rule.commentReplyTemplate ? (
            <div>
              <p className="mb-1 text-sm font-medium">Comment Reply Template:</p>
              <p className="text-muted-foreground bg-muted rounded p-2 text-sm">
                {rule.commentReplyTemplate}
              </p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
