import { ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useBrandStore } from '@/stores/brandStore';

import {
  categoryTitle,
  type NotificationGroup,
  type NotificationRow,
  useNotificationPreferences,
} from './notification-preferences/use-notification-preferences';

function GroupItemRow({
  groupCategory,
  item,
  row,
  disabled,
  onToggle,
}: {
  groupCategory: string;
  item: NotificationGroup['items'][number];
  row: NotificationRow;
  disabled: boolean;
  onToggle: (index: number, channel: 'in_app' | 'email') => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium">{item.title}</div>
        <div className="text-muted-foreground text-xs">{item.description}</div>
        <div className="text-muted-foreground mt-1 font-mono text-[10px]">{row.type}</div>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch
            checked={row.in_app}
            disabled={disabled}
            onCheckedChange={() => onToggle(item.index, 'in_app')}
          />
          <Label>In-app</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={row.email}
            disabled={disabled}
            onCheckedChange={() => onToggle(item.index, 'email')}
          />
          <Label>Email</Label>
        </div>
      </div>
      {groupCategory !== 'accounts' ? null : <div className="h-0" />}
    </div>
  );
}

function NotificationGroupCard({
  group,
  rows,
  masters,
  expanded,
  setExpanded,
  onToggle,
  onToggleTypeMaster,
  onToggleGroupMaster,
}: {
  group: NotificationGroup;
  rows: NotificationRow[];
  masters: Record<string, boolean>;
  expanded: Record<string, boolean>;
  setExpanded: (next: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  onToggle: (index: number, channel: 'in_app' | 'email') => void;
  onToggleTypeMaster: (key: string, enabled: boolean) => void;
  onToggleGroupMaster: (category: string, enabled: boolean) => void;
}) {
  const isOpen = Boolean(expanded[group.key]);
  const groupMasterEnabled = group.category === 'accounts' ? (masters.accounts ?? true) : undefined;
  const anyEnabled =
    groupMasterEnabled !== undefined
      ? groupMasterEnabled
      : group.indices.some((index) => rows[index]?.in_app || rows[index]?.email);

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between p-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setExpanded((state) => ({ ...state, [group.key]: !isOpen }))}
          className="hover:bg-accent/50 group -ml-1 h-auto flex-1 justify-start gap-2 rounded px-1 py-1 text-left"
          aria-expanded={isOpen}
        >
          {isOpen ? (
            <ChevronDown className="text-muted-foreground h-4 w-4 transition-transform" />
          ) : (
            <ChevronRight className="text-muted-foreground h-4 w-4 transition-transform" />
          )}
          <Badge variant="secondary" className="uppercase">
            {categoryTitle(group.category)}
          </Badge>
          <div className="text-sm font-medium">
            {group.category === 'accounts' ? 'Account Settings' : group.title}
          </div>
        </Button>
        <GroupMasterSwitch
          category={group.category}
          anyEnabled={anyEnabled}
          firstRow={rows[group.indices[0]!]}
          onToggleTypeMaster={onToggleTypeMaster}
          onToggleGroupMaster={onToggleGroupMaster}
        />
      </div>

      {isOpen ? (
        <GroupItemsPanel group={group} rows={rows} masters={masters} onToggle={onToggle} />
      ) : null}
    </div>
  );
}

function GroupMasterSwitch({
  category,
  anyEnabled,
  firstRow,
  onToggleTypeMaster,
  onToggleGroupMaster,
}: {
  category: string;
  anyEnabled: boolean;
  firstRow: NotificationRow | undefined;
  onToggleTypeMaster: (key: string, enabled: boolean) => void;
  onToggleGroupMaster: (category: string, enabled: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 pr-1">
      <Label className="text-xs">Enabled</Label>
      {category === 'accounts' ? (
        <Switch
          checked={anyEnabled}
          onCheckedChange={(enabled) => onToggleGroupMaster('accounts', enabled)}
        />
      ) : (
        <Switch
          checked={anyEnabled}
          onCheckedChange={(enabled) => {
            if (firstRow) {
              onToggleTypeMaster(`${firstRow.category}:${firstRow.type}`, enabled);
            }
          }}
        />
      )}
    </div>
  );
}

function GroupItemsPanel({
  group,
  rows,
  masters,
  onToggle,
}: {
  group: NotificationGroup;
  rows: NotificationRow[];
  masters: Record<string, boolean>;
  onToggle: (index: number, channel: 'in_app' | 'email') => void;
}) {
  return (
    <div className="border-t p-3">
      {group.items.map((item, index) => {
        const row = rows[item.index];
        if (!row) {
          return null;
        }
        const disabled = group.category === 'accounts' ? !(masters.accounts ?? true) : false;
        return (
          <div key={item.key} className={index > 0 ? 'mt-4 border-t pt-4' : ''}>
            <GroupItemRow
              groupCategory={group.category}
              item={item}
              row={row}
              disabled={disabled}
              onToggle={onToggle}
            />
          </div>
        );
      })}
    </div>
  );
}

export default function NotificationPreferencesPanel() {
  const { selectedBrand } = useBrandStore();
  const brandId = selectedBrand?.id;
  const {
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
  } = useNotificationPreferences(brandId);

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
          <Button onClick={sendTest} disabled={saving}>
            Send test notification
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div className="text-muted-foreground text-xs font-medium">Notification types</div>
        {groups.map((group) => (
          <NotificationGroupCard
            key={group.key}
            group={group}
            rows={rows}
            masters={masters}
            expanded={expanded}
            setExpanded={setExpanded}
            onToggle={toggle}
            onToggleTypeMaster={toggleTypeMaster}
            onToggleGroupMaster={toggleGroupMaster}
          />
        ))}
      </div>
    </div>
  );
}
