import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { notifications as notificationsApi } from '@/lib/api';

export type NotificationRow = {
  category: string;
  type: string;
  in_app: boolean;
  email: boolean;
};

export type NotificationGroup = {
  key: string;
  category: string;
  title: string;
  indices: number[];
  items: Array<{
    index: number;
    key: string;
    title: string;
    description: string;
  }>;
};

type NotificationMeta = {
  title: string;
  description: string;
};

const KNOWN_NOTIFICATION_META: Record<string, NotificationMeta> = {
  'publishing.post_failed': {
    title: 'Post Failed',
    description: 'A scheduled post failed to publish. Review details and retry.',
  },
  'accounts.account_disconnected': {
    title: 'Account Disconnected',
    description: 'A connected social account lost authorization. Reconnect to resume publishing.',
  },
  'accounts.token_expiring': {
    title: 'Token Expiring',
    description: 'A connected account token is expiring soon. Refresh credentials.',
  },
  'billing.payment_failed': {
    title: 'Payment Failed',
    description: 'A payment attempt failed. Update your billing method.',
  },
  'system.test_notification': {
    title: 'Test Notification',
    description: 'Used to verify your notification setup and preferences.',
  },
};

export function categoryTitle(category: string): string {
  const map: Record<string, string> = {
    publishing: 'Publishing',
    accounts: 'Accounts',
    billing: 'Billing',
    collaboration: 'Collaboration',
    system: 'System',
  };
  return map[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

function humanizeType(type: string): string {
  const last = type.split('.').pop() || type;
  const words = last.replace(/[_-]+/g, ' ').split(' ');
  return words
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function getNotificationMeta(_category: string, type: string): NotificationMeta {
  return (
    KNOWN_NOTIFICATION_META[type] ?? {
      title: humanizeType(type),
      description: `Notification about: ${humanizeType(type).toLowerCase()}`,
    }
  );
}

function buildRowsFromResponse(response: any): {
  rows: NotificationRow[];
  masters: Record<string, boolean>;
} {
  const map = new Map<string, Partial<{ in_app: boolean; email: boolean }>>();
  const masters: Record<string, boolean> = {};

  for (const preference of response.items) {
    if (preference.channel === 'all' && preference.type === 'all') {
      masters[preference.category] = Boolean(preference.enabled);
      continue;
    }
    const key = `${preference.category}:${preference.type}`;
    const entry = map.get(key) ?? {};
    if (preference.channel === 'in_app') {
      entry.in_app = preference.enabled;
    }
    if (preference.channel === 'email') {
      entry.email = preference.enabled;
    }
    map.set(key, entry);
  }

  const keys = new Set<string>([
    ...Array.from(map.keys()),
    ...response.defaults.map((def: any) => `${def.category}:${def.type}`),
  ]);
  const rows = Array.from(keys).map((key) => {
    const [category, type] = key.split(':');
    const defaultsForKey = response.defaults.filter(
      (def: any) => def.category === category && def.type === type
    );
    const defaultInApp =
      defaultsForKey.find((def: any) => def.channel === 'in_app')?.enabled ?? false;
    const defaultEmail =
      defaultsForKey.find((def: any) => def.channel === 'email')?.enabled ?? false;
    const entry = map.get(key) ?? {};
    return {
      category,
      type,
      in_app: entry.in_app ?? defaultInApp,
      email: entry.email ?? defaultEmail,
    } satisfies NotificationRow;
  });
  rows.sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type));

  return { rows, masters };
}

function buildNotificationGroups(rows: NotificationRow[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  const accountIndices = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.category === 'accounts')
    .map(({ index }) => index);

  if (accountIndices.length > 0) {
    const items = accountIndices.map((index) => {
      const row = rows[index]!;
      const meta = getNotificationMeta(row.category, row.type);
      return {
        index,
        key: `${row.category}:${row.type}`,
        title: row.type === 'accounts.account_disconnected' ? 'Account is connected' : meta.title,
        description: meta.description,
      };
    });
    groups.push({
      key: 'group:accounts:account_settings',
      category: 'accounts',
      title: 'Account Settings',
      indices: accountIndices,
      items,
    });
  }

  rows.forEach((row, index) => {
    if (row.category === 'accounts') {
      return;
    }
    const meta = getNotificationMeta(row.category, row.type);
    groups.push({
      key: `${row.category}:${row.type}`,
      category: row.category,
      title: meta.title,
      indices: [index],
      items: [
        {
          index,
          key: `${row.category}:${row.type}`,
          title: meta.title,
          description: meta.description,
        },
      ],
    });
  });

  return groups.sort(
    (a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)
  );
}

function useLoadPreferences(params: {
  brandId: string | undefined;
  setRows: (rows: NotificationRow[]) => void;
  setMasters: (masters: Record<string, boolean>) => void;
  setLoading: (loading: boolean) => void;
}) {
  const { brandId, setRows, setMasters, setLoading } = params;
  return useCallback(async () => {
    setLoading(true);
    try {
      const response = await notificationsApi.getPreferences(brandId);
      const next = buildRowsFromResponse(response);
      setRows(next.rows);
      setMasters(next.masters);
    } catch (error) {
      console.error('Failed to load notification preferences', error);
      toast.error('Failed to load preferences');
    } finally {
      setLoading(false);
    }
  }, [brandId, setLoading, setMasters, setRows]);
}

function useChannelToggle(params: {
  brandId: string | undefined;
  rows: NotificationRow[];
  setRows: (rows: NotificationRow[]) => void;
  setSaving: (saving: boolean) => void;
}) {
  const { brandId, rows, setRows, setSaving } = params;
  return useCallback(
    async (index: number, channel: 'in_app' | 'email') => {
      const nextRows = [...rows];
      const row = nextRows[index];
      if (!row) {
        return;
      }
      row[channel] = !row[channel];
      setRows(nextRows);

      try {
        setSaving(true);
        await notificationsApi.updatePreferences([
          { category: row.category, type: row.type, brandId, channel, enabled: row[channel] },
        ]);
        toast.success('Preferences saved');
      } catch {
        row[channel] = !row[channel];
        setRows([...nextRows]);
        toast.error('Failed to save preferences');
      } finally {
        setSaving(false);
      }
    },
    [brandId, rows, setRows, setSaving]
  );
}

function useTypeMasterToggle(params: {
  brandId: string | undefined;
  rows: NotificationRow[];
  setRows: (rows: NotificationRow[]) => void;
  setSaving: (saving: boolean) => void;
}) {
  const { brandId, rows, setRows, setSaving } = params;
  return useCallback(
    async (key: string, enabled: boolean) => {
      const index = rows.findIndex((row) => `${row.category}:${row.type}` === key);
      if (index === -1) {
        return;
      }
      const nextRows = [...rows];
      const row = { ...nextRows[index]! };
      const previous = { in_app: row.in_app, email: row.email };
      row.in_app = enabled;
      row.email = enabled;
      nextRows[index] = row;
      setRows(nextRows);

      try {
        setSaving(true);
        const updates = (['in_app', 'email'] as const)
          .filter((channel) => previous[channel] !== enabled)
          .map((channel) => ({
            category: row.category,
            type: row.type,
            brandId,
            channel,
            enabled,
          }));
        if (updates.length > 0) {
          await notificationsApi.updatePreferences(updates);
        }
        toast.success(`Preferences ${enabled ? 'enabled' : 'disabled'} for ${row.type}`);
      } catch {
        const reverted = [...rows];
        if (reverted[index]) {
          reverted[index] = { ...reverted[index], ...previous };
          setRows(reverted);
        }
        toast.error('Failed to update preferences');
      } finally {
        setSaving(false);
      }
    },
    [brandId, rows, setRows, setSaving]
  );
}

function useGroupMasterToggle(params: {
  brandId: string | undefined;
  masters: Record<string, boolean>;
  setMasters: (updater: (current: Record<string, boolean>) => Record<string, boolean>) => void;
  setSaving: (saving: boolean) => void;
}) {
  const { brandId, masters, setMasters, setSaving } = params;
  return useCallback(
    async (category: string, enabled: boolean) => {
      const previous = masters[category];
      setMasters((current) => ({ ...current, [category]: enabled }));
      try {
        setSaving(true);
        await notificationsApi.updatePreferences([
          { category, type: 'all', brandId, channel: 'all', enabled },
        ]);
        toast.success(
          `Notifications ${enabled ? 'enabled' : 'disabled'} for ${categoryTitle(category)}`
        );
      } catch {
        setMasters((current) => ({ ...current, [category]: previous }));
        toast.error('Failed to update preferences');
      } finally {
        setSaving(false);
      }
    },
    [brandId, masters, setMasters, setSaving]
  );
}

function useSendTestNotification(brandId: string | undefined) {
  return useCallback(async () => {
    try {
      await notificationsApi.sendTest(brandId);
      toast.success('Test notification sent');
    } catch {
      toast.error('Failed to send test notification');
    }
  }, [brandId]);
}

export function useNotificationPreferences(brandId: string | undefined) {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [masters, setMasters] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => buildNotificationGroups(rows), [rows]);
  const load = useLoadPreferences({ brandId, setRows, setMasters, setLoading });
  const toggle = useChannelToggle({ brandId, rows, setRows, setSaving });
  const toggleTypeMaster = useTypeMasterToggle({ brandId, rows, setRows, setSaving });
  const toggleGroupMaster = useGroupMasterToggle({ brandId, masters, setMasters, setSaving });
  const sendTest = useSendTestNotification(brandId);

  useEffect(() => {
    if (groups.length === 0 || Object.keys(expanded).length > 0) {
      return;
    }
    setExpanded(Object.fromEntries(groups.map((group) => [group.key, true])));
  }, [expanded, groups]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    rows,
    loading,
    saving,
    expanded,
    masters,
    groups,
    setExpanded,
    load,
    toggle,
    toggleTypeMaster,
    toggleGroupMaster,
    sendTest,
  };
}
