import type { SecuritySummary } from '../../lib/api';
import { Card, CardContent } from '@/components/ui/card';
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
        return 'bg-success/15';
      case 'warning':
        return 'bg-warning/15';
      case 'danger':
        return 'bg-destructive/10';
      default:
        return 'bg-muted';
    }
  };

  const getIconColor = () => {
    switch (variant) {
      case 'success':
        return 'text-success';
      case 'warning':
        return 'text-warning';
      case 'danger':
        return 'text-destructive';
      default:
        return 'text-foreground';
    }
  };

  return (
    <Card className={getBgColor()}>
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className={`rounded-lg p-2 ${getIconColor()}`}>{icon}</div>
          <div className="flex-1">
            <p className="text-muted-foreground text-sm font-medium">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
            {description && <p className="text-muted-foreground mt-1 text-xs">{description}</p>}
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

  let passwordAgeValue = '—';
  if (usingOAuthOnly) {
    passwordAgeValue = 'Not set';
  } else if (summary.lastPasswordChange) {
    const daysSinceChange = Math.floor(
      (Date.now() - new Date(summary.lastPasswordChange).getTime()) / (1000 * 60 * 60 * 24)
    );
    passwordAgeValue = `${daysSinceChange} days`;
  }

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
        value={passwordAgeValue}
        description={passwordStatus.description}
        variant={passwordStatus.variant}
      />
    </div>
  );
}
