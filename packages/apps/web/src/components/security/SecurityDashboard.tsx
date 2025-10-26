import { useState, useEffect } from 'react';
import type { SecuritySummary, LoginHistoryResponse } from '../../lib/api';
import { session } from '../../lib/api';
import { SecurityMetrics } from './SecurityMetrics';
import { LoginHistory } from './LoginHistory';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle } from 'lucide-react';

export function SecurityDashboard() {
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [summaryData, historyData] = await Promise.all([
        session.getSecuritySummary(),
        session.getLoginHistory(),
      ]);

      setSummary(summaryData);
      setLoginHistory(historyData);
    } catch (err) {
      console.error('Failed to load security data:', err);
      setError('Failed to load security information. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-foreground h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !summary || !loginHistory) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error || 'Failed to load security data.'}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Security Dashboard</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Monitor your account security and login activity
        </p>
      </div>

      <SecurityMetrics summary={summary} />

      {summary.lastLogin && (
        <Alert variant="info">
          <AlertDescription>
            <strong>Last login:</strong> {new Date(summary.lastLogin.timestamp).toLocaleString()}{' '}
            {summary.lastLogin.location &&
              `from ${summary.lastLogin.location.city}, ${summary.lastLogin.location.country}`}{' '}
            using {summary.lastLogin.device}
          </AlertDescription>
        </Alert>
      )}

      <LoginHistory history={loginHistory.history} />
    </div>
  );
}
