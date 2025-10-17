import type { SecuritySummary } from '../../lib/api';
import { Card, CardContent } from '../ui/card';
import { Shield, LogIn, AlertTriangle, Key } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface SecurityMetricsProps {
  summary: SecuritySummary;
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  description?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

function MetricCard({ icon, label, value, description, variant = 'default' }: MetricCardProps) {
  const getBgColor = () => {
    switch (variant) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'warning':
        return 'bg-amber-50 border-amber-200';
      case 'danger':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getIconColor = () => {
    switch (variant) {
      case 'success':
        return 'text-green-600';
      case 'warning':
        return 'text-amber-600';
      case 'danger':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <Card className={getBgColor()}>
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className={`rounded-lg p-2 ${getIconColor()}`}>{icon}</div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-600">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
            {description && <p className="mt-1 text-xs text-gray-500">{description}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SecurityMetrics({ summary }: SecurityMetricsProps) {
  const usingOAuthOnly = summary.passwordAuthEnabled === false;

  const getPasswordChangeStatus = () => {
    try {
      if (usingOAuthOnly) {
        const provider = summary.oauthProviders?.[0];
        return {
          variant: 'default' as const,
          description: provider ? `Using ${provider} sign-in` : 'No password set',
        };
      }
      if (!summary.lastPasswordChange) {
        return { variant: 'default' as const, description: 'Unknown' };
      }

      const daysSinceChange = Math.floor(
        (Date.now() - new Date(summary.lastPasswordChange).getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceChange > 180) {
        return { variant: 'danger' as const, description: 'Consider updating your password' };
      } else if (daysSinceChange > 90) {
        return { variant: 'warning' as const, description: 'Password is aging' };
      }
      return {
        variant: 'success' as const,
        description: formatDistanceToNow(new Date(summary.lastPasswordChange), {
          addSuffix: true,
        }),
      };
    } catch {
      return { variant: 'default' as const, description: 'Unknown' };
    }
  };

  const passwordStatus = getPasswordChangeStatus();

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        icon={<Shield className="h-6 w-6" />}
        label="Active Sessions"
        value={summary.activeSessions}
        description={`${summary.activeSessions} ${summary.activeSessions === 1 ? 'device' : 'devices'} logged in`}
        variant={summary.activeSessions > 5 ? 'warning' : 'default'}
      />

      <MetricCard
        icon={<LogIn className="h-6 w-6" />}
        label="Recent Logins"
        value={summary.recentLogins}
        description="Last 10 sessions"
        variant="default"
      />

      <MetricCard
        icon={<AlertTriangle className="h-6 w-6" />}
        label="Suspicious Activity"
        value={summary.suspiciousActivity}
        description={summary.suspiciousActivity === 0 ? 'All clear' : 'Needs attention'}
        variant={summary.suspiciousActivity > 0 ? 'danger' : 'success'}
      />

      <MetricCard
        icon={<Key className="h-6 w-6" />}
        label="Password Age"
        value={
          usingOAuthOnly
            ? 'Not set'
            : summary.lastPasswordChange
              ? `${Math.floor((Date.now() - new Date(summary.lastPasswordChange).getTime()) / (1000 * 60 * 60 * 24))} days`
              : '—'
        }
        description={passwordStatus.description}
        variant={passwordStatus.variant}
      />
    </div>
  );
}
