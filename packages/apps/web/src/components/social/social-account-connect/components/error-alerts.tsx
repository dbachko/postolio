import { Alert, AlertDescription } from '@/components/ui/alert';

interface ErrorAlertsProps {
  platformLabel: string;
  connectErrorMessage?: string | null;
  disconnectErrorMessage?: string | null;
  refreshErrorMessage?: string | null;
}

export function ErrorAlerts({
  platformLabel,
  connectErrorMessage,
  disconnectErrorMessage,
  refreshErrorMessage,
}: ErrorAlertsProps) {
  return (
    <>
      {connectErrorMessage && (
        <Alert variant="destructive">
          <AlertDescription>
            {connectErrorMessage || `Failed to connect ${platformLabel} account`}
          </AlertDescription>
        </Alert>
      )}

      {disconnectErrorMessage && (
        <Alert variant="destructive">
          <AlertDescription>
            {disconnectErrorMessage || `Failed to disconnect ${platformLabel} account`}
          </AlertDescription>
        </Alert>
      )}

      {refreshErrorMessage && (
        <Alert variant="destructive">
          <AlertDescription>
            {refreshErrorMessage || `Failed to refresh ${platformLabel} status`}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
