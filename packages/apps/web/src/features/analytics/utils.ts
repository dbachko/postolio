import type { Period, ConnectedAccount } from './types';

export function periodFromDays(days: number): Period {
  if (days === 7) {
    return '7d';
  }
  if (days === 90) {
    return '90d';
  }
  return '30d';
}

export function daysFromPeriod(period: Period): 7 | 30 | 90 {
  if (period === '7d') {
    return 7;
  }
  if (period === '90d') {
    return 90;
  }
  return 30;
}

export function getAccountDisplayName(
  account: Pick<ConnectedAccount, 'displayName' | 'username' | 'externalAccountId'>
): string {
  return account.displayName || account.username || account.externalAccountId;
}
