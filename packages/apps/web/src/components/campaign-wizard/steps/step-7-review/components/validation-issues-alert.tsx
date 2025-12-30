import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ValidationIssue } from '../types';

interface ValidationIssuesAlertProps {
  issues: ValidationIssue[];
  onGoToStep: (step: number) => void;
}

export function ValidationIssuesAlert({ issues, onGoToStep }: ValidationIssuesAlertProps) {
  if (issues.length === 0) return null;

  return (
    <Alert variant="destructive">
      <AlertDescription>
        <div className="font-semibold">Cannot create campaign yet:</div>
        <ul className="mt-2 space-y-1">
          {issues.map((issue) => (
            <li key={issue.field} className="flex items-center gap-2">
              <span>•</span>
              <span>{issue.message}</span>
              {issue.step > 0 && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs underline"
                  onClick={() => onGoToStep(issue.step)}
                >
                  (Go to step {issue.step})
                </Button>
              )}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
