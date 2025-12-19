import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { useBrandStore } from '../../stores/brandStore';
import { notifications as notificationsApi } from '../../lib/api';

type NotificationRow = {
  category: string;
  type: string;
  in_app: boolean;
  email: boolean;
};

type Group = {
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

export default function NotificationPreferencesPanel() {
  const { selectedBrand } = useBrandStore();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [masters, setMasters] = useState<Record<string, boolean>>({});

  const categoryTitle = (category: string) => {
    const map: Record<string, string> = {
      publishing: 'Publishing',
      accounts: 'Accounts',
      billing: 'Billing',
      collaboration: 'Collaboration',
      system: 'System',
    };
    return map[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
  };

  const humanizeType = (type: string) => {
    const last = type.split('.').pop() || type;
    const words = last.replace(/[_-]+/g, ' ').split(' ');
    return words.map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
  };

  const getMeta = (category: string, type: string) => {
    const byType: Record<string, { title: string; description: string }> = {
      'publishing.post_failed': {
        title: 'Post Failed',
        description: 'A scheduled post failed to publish. Review details and retry.',
      },
      'accounts.account_disconnected': {
        title: 'Account Disconnected',
        description:
          'A connected social account lost authorization. Reconnect to resume publishing.',
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
    const meta = byType[type] ?? {
      title: humanizeType(type),
      description: 'Notification about: ' + humanizeType(type).toLowerCase(),
    };
    return { categoryLabel: categoryTitle(category), ...meta };
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await notificationsApi.getPreferences(selectedBrand?.id);
      const map = new Map<string, Partial<{ in_app: boolean; email: boolean }>>();
      const masterMap: Record<string, boolean> = {};

      for (const p of res.items) {
        if (p.channel === 'all' && p.type === 'all') {
          masterMap[p.category] = !!p.enabled;
          continue;
        }
        const key = `${p.category}:${p.type}`;
        const entry = map.get(key) ?? {};
        if (p.channel === 'in_app') entry.in_app = p.enabled;
        if (p.channel === 'email') entry.email = p.enabled;
        map.set(key, entry);
      }

      const keys = new Set<string>([
        ...Array.from(map.keys()),
        ...res.defaults.map((d) => `${d.category}:${d.type}`),
      ]);

      const newRows: NotificationRow[] = Array.from(keys).map((key) => {
        const [category, type] = key.split(':');
        const entry = map.get(key) ?? {};
        const defaultsForKey = res.defaults.filter(
          (d) => d.category === category && d.type === type
        );
        const defaultInApp = defaultsForKey.find((d) => d.channel === 'in_app')?.enabled ?? false;
        const defaultEmail = defaultsForKey.find((d) => d.channel === 'email')?.enabled ?? false;
        return {
          category,
          type,
          in_app: entry.in_app ?? defaultInApp,
          email: entry.email ?? defaultEmail,
        };
      });

      newRows.sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type));
      setRows(newRows);
      setMasters(masterMap);
    } catch (_e) {
      console.error('Failed to load notification preferences', _e);
      toast.error('Failed to load preferences');
    } finally {
      setLoading(false);
    }
  }, [selectedBrand?.id]);

  const buildGroups = (): Group[] => {
    const groups: Group[] = [];
    const accountIndices: number[] = [];

    rows.forEach((r, i) => {
      if (r.category === 'accounts') accountIndices.push(i);
    });

    if (accountIndices.length > 0) {
      const items = accountIndices.map((i) => {
        const r = rows[i];
        const meta = getMeta(r.category, r.type);
        const displayTitle =
          r.type === 'accounts.account_disconnected' ? 'Account is connected' : meta.title;
        return {
          index: i,
          key: `${r.category}:${r.type}`,
          title: displayTitle,
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

    rows.forEach((r, i) => {
      if (r.category === 'accounts') return;
      const meta = getMeta(r.category, r.type);
      groups.push({
        key: `${r.category}:${r.type}`,
        category: r.category,
        title: meta.title,
        indices: [i],
        items: [
          {
            index: i,
            key: `${r.category}:${r.type}`,
            title: meta.title,
            description: meta.description,
          },
        ],
      });
    });

    return groups.sort(
      (a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)
    );
  };

  useEffect(() => {
    if (rows.length > 0 && Object.keys(expanded).length === 0) {
      const defaults: Record<string, boolean> = {};
      for (const g of buildGroups()) defaults[g.key] = true;
      setExpanded(defaults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (idx: number, channel: 'in_app' | 'email') => {
    const next = [...rows];
    const row = next[idx];
    row[channel] = !row[channel];
    setRows(next);
    try {
      setSaving(true);
      await notificationsApi.updatePreferences([
        {
          category: row.category,
          type: row.type,
          brandId: selectedBrand?.id,
          channel,
          enabled: row[channel],
        },
      ]);
      toast.success('Preferences saved');
    } catch (_e) {
      toast.error('Failed to save preferences');
      row[channel] = !row[channel];
      setRows([...next]);
    } finally {
      setSaving(false);
    }
  };

  const toggleTypeMaster = async (key: string, enabled: boolean) => {
    const idx = rows.findIndex((r) => `${r.category}:${r.type}` === key);
    if (idx === -1) return;
    const next = [...rows];
    const row = { ...next[idx] };
    const prev = { in_app: row.in_app, email: row.email };
    row.in_app = enabled;
    row.email = enabled;
    next[idx] = row;
    setRows(next);
    try {
      setSaving(true);
      const updates: Array<{
        category: string;
        type: string;
        brandId?: string;
        channel: 'in_app' | 'email';
        enabled: boolean;
      }> = [];
      if (prev.in_app !== enabled)
        updates.push({
          category: row.category,
          type: row.type,
          brandId: selectedBrand?.id,
          channel: 'in_app',
          enabled,
        });
      if (prev.email !== enabled)
        updates.push({
          category: row.category,
          type: row.type,
          brandId: selectedBrand?.id,
          channel: 'email',
          enabled,
        });
      if (updates.length > 0) await notificationsApi.updatePreferences(updates);
      toast.success(`Preferences ${enabled ? 'enabled' : 'disabled'} for ${row.type}`);
    } catch (_e) {
      const revert = [...rows];
      if (revert[idx]) {
        revert[idx] = { ...revert[idx], ...prev };
        setRows(revert);
      }
      toast.error('Failed to update preferences');
    } finally {
      setSaving(false);
    }
  };

  const toggleGroupMaster = async (category: string, enabled: boolean) => {
    const prev = masters[category];
    setMasters((m) => ({ ...m, [category]: enabled }));
    try {
      setSaving(true);
      await notificationsApi.updatePreferences([
        {
          category,
          type: 'all',
          brandId: selectedBrand?.id,
          channel: 'all',
          enabled,
        },
      ]);
      toast.success(
        `Notifications ${enabled ? 'enabled' : 'disabled'} for ${categoryTitle(category)}`
      );
    } catch (_e) {
      setMasters((m) => ({ ...m, [category]: prev }));
      toast.error('Failed to update preferences');
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    try {
      await notificationsApi.sendTest(selectedBrand?.id);
      toast.success('Test notification sent');
    } catch (_e) {
      toast.error('Failed to send test notification');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground text-sm">
          {selectedBrand ? `Preferences for ${selectedBrand.name}` : 'Account-level preferences'}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button onClick={handleSendTest} disabled={saving}>
            Send test notification
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <div className="text-muted-foreground text-xs font-medium">Notification types</div>
        {buildGroups().map((g) => {
          const key = g.key;
          const isOpen = !!expanded[key];
          const groupMasterEnabled =
            g.category === 'accounts' ? (masters['accounts'] ?? true) : undefined;
          const anyEnabled =
            groupMasterEnabled !== undefined
              ? groupMasterEnabled
              : g.indices.some((idx) => rows[idx]?.in_app || rows[idx]?.email);
          return (
            <div key={key} className="rounded-md border">
              <div className="flex items-center justify-between p-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setExpanded((s) => ({ ...s, [key]: !isOpen }))}
                  className="hover:bg-accent/50 group -ml-1 h-auto flex-1 justify-start gap-2 rounded px-1 py-1 text-left"
                  aria-expanded={isOpen}
                >
                  {isOpen ? (
                    <ChevronDown className="text-muted-foreground h-4 w-4 transition-transform" />
                  ) : (
                    <ChevronRight className="text-muted-foreground h-4 w-4 transition-transform" />
                  )}
                  <Badge variant="secondary" className="uppercase">
                    {categoryTitle(g.category)}
                  </Badge>
                  <div className="text-sm font-medium">
                    {g.category === 'accounts' ? 'Account Settings' : g.title}
                  </div>
                </Button>
                <div className="flex items-center gap-2 pr-1">
                  <Label className="text-xs">Enabled</Label>
                  {g.category === 'accounts' ? (
                    <Switch
                      checked={anyEnabled}
                      onCheckedChange={(v) => toggleGroupMaster('accounts', v)}
                    />
                  ) : (
                    <Switch
                      checked={anyEnabled}
                      onCheckedChange={(v) =>
                        toggleTypeMaster(
                          `${rows[g.indices[0]].category}:${rows[g.indices[0]].type}`,
                          v
                        )
                      }
                    />
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="border-t p-3">
                  {g.items.map((item, idx) => {
                    const r = rows[item.index];
                    if (!r) return null;
                    const disabled =
                      g.category === 'accounts' ? !(masters['accounts'] ?? true) : false;
                    return (
                      <div key={item.key} className={idx > 0 ? 'mt-4 border-t pt-4' : ''}>
                        <div className="mb-1 text-sm font-medium">{item.title}</div>
                        <div className="text-muted-foreground mb-2 text-xs">{item.description}</div>
                        <div className="text-muted-foreground mb-3 font-mono text-[10px]">
                          {r.type}
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={r.in_app}
                              disabled={disabled}
                              onCheckedChange={() => toggle(item.index, 'in_app')}
                            />
                            <Label>In‑app</Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={r.email}
                              disabled={disabled}
                              onCheckedChange={() => toggle(item.index, 'email')}
                            />
                            <Label>Email</Label>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
