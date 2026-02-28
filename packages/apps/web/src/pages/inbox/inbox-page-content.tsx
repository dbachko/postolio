import { formatDistanceToNow } from 'date-fns';
import { Inbox as InboxIcon, MessageCircle, RotateCw, Search } from 'lucide-react';

import type { Platform } from '@/lib/platform-config';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';

import { InboxDetailPanel } from './inbox-detail-panel';
import { getInboxItemKey } from './inbox-utils';
import type { InboxChannelFilter, InboxItem, InboxPlatformFilter } from './types';
import type { useInboxPageModel } from './use-inbox-page-model';

type InboxPageModel = ReturnType<typeof useInboxPageModel>;

function BrandRequiredCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Inbox</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-muted-foreground flex items-center justify-center p-8 text-center">
          Please select a brand to view inbox
        </div>
      </CardContent>
    </Card>
  );
}

function AccountList({ model }: { model: InboxPageModel }) {
  return (
    <Card className="lg:col-span-3">
      <CardContent className="p-0">
        <ScrollArea className="h-[calc(100vh-16rem)]">
          <div className="space-y-1 p-2">
            {model.socialAccounts.map((account) => (
              <AccountListRow key={account.id} account={account} model={model} />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function AccountListRow({
  account,
  model,
}: {
  account: InboxPageModel['socialAccounts'][number];
  model: InboxPageModel;
}) {
  const id = String(account.id);
  const label = account.username ? `@${account.username}` : account.displayName || 'Account';
  const count = model.itemCountBySocialAccountId.get(id) || 0;
  const disabled = Boolean(account.disconnected);
  const isSelected = model.selectedAccountId === id;

  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) {
          model.setSelectedAccountId(id);
        }
      }}
      className={cn(
        'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
        isSelected ? 'bg-muted border-border' : 'bg-card hover:bg-muted/50',
        disabled && 'cursor-not-allowed opacity-50'
      )}
      aria-disabled={disabled}
    >
      <div className="flex min-w-0 items-center gap-3">
        <SocialAccountAvatar
          platform={account.platform as Platform}
          name={label}
          src={account.profilePictureUrl || null}
          size="sm"
          selected={isSelected}
          muted={!isSelected}
          disabled={disabled}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{label}</div>
          <div className="text-muted-foreground truncate text-xs">
            {String(account.platform || '').toUpperCase()}
          </div>
        </div>
      </div>
      {count > 0 ? <span className="text-muted-foreground text-xs">{count}</span> : null}
    </button>
  );
}

function getItemTimeValue(item: InboxItem) {
  if (item.type === 'dm_conversation') {
    return item.lastMessageAt;
  }
  return item.lastActivityAt || item.postedAt || null;
}

function getItemTitle(item: InboxItem) {
  if (item.type === 'dm_conversation') {
    return item.participantUsername;
  }
  if (item.previewAuthorUsername) {
    return `@${item.previewAuthorUsername}`;
  }
  return 'Comments';
}

function getItemPreview(item: InboxItem) {
  if (item.type === 'dm_conversation') {
    return item.lastMessageText || '';
  }
  return item.previewText || item.caption || '';
}

function getItemBadgeText(item: InboxItem) {
  if (item.type === 'comment_thread' && item.newCount > 0) {
    return String(item.newCount);
  }
  return null;
}

function ItemTypeIcon({ type }: { type: InboxItem['type'] }) {
  if (type === 'dm_conversation') {
    return <InboxIcon className="text-muted-foreground h-4 w-4" />;
  }
  return <MessageCircle className="text-muted-foreground h-4 w-4" />;
}

function ItemRowTrailingMeta({
  badgeText,
  timeAgo,
}: {
  badgeText: string | null;
  timeAgo: string | null;
}) {
  return (
    <div className="flex items-center gap-2">
      {badgeText ? (
        <div className="bg-primary text-primary-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs">
          {badgeText}
        </div>
      ) : null}
      {timeAgo ? <div className="text-muted-foreground text-xs">{timeAgo}</div> : null}
    </div>
  );
}

function ItemRow({ model, item }: { model: InboxPageModel; item: InboxItem }) {
  const isSelected = model.selectedItemKey === getInboxItemKey(item);
  const account = model.socialAccountById.get(item.socialAccountId) || null;
  const accountName = account?.displayName || account?.username || 'Account';
  const accountAvatarUrl = account?.profilePictureUrl || null;
  const accountPlatform = (account?.platform || item.platform) as Platform;
  const timeValue = getItemTimeValue(item);
  const timeAgo = timeValue ? formatDistanceToNow(new Date(timeValue), { addSuffix: true }) : null;
  const title = getItemTitle(item);
  const preview = getItemPreview(item);
  const badgeText = getItemBadgeText(item);
  const accountHandle =
    typeof account?.username === 'string' && account.username.trim().length > 0
      ? `@${account.username}`
      : accountName;

  return (
    <button
      type="button"
      onClick={() => model.setSelectedItemKey(getInboxItemKey(item))}
      className={cn(
        'w-full rounded-md border p-3 text-left transition-colors',
        isSelected ? 'bg-muted border-border' : 'bg-card hover:bg-muted/50'
      )}
    >
      <div className="flex items-start gap-3">
        <SocialAccountAvatar
          platform={accountPlatform}
          name={accountName}
          src={accountAvatarUrl}
          size="sm"
          selected={isSelected}
          muted={!isSelected}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <ItemTypeIcon type={item.type} />
              <div className="text-foreground truncate text-sm font-medium">{title}</div>
            </div>
            <ItemRowTrailingMeta badgeText={badgeText} timeAgo={timeAgo} />
          </div>
          <div className="text-muted-foreground mt-1 line-clamp-2 text-xs">{preview}</div>
          <div className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
            <span className="truncate">{accountHandle}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function ItemList({ model }: { model: InboxPageModel }) {
  return (
    <Card className="lg:col-span-4">
      <CardHeader className="border-b">
        <ItemFilters model={model} />
        <div className="mt-3 flex items-center gap-2">
          <Search className="text-muted-foreground h-4 w-4" />
          <Input
            value={model.itemQuery}
            onChange={(event) => model.setItemQuery(event.target.value)}
            placeholder="Search inbox..."
            className="h-9"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[calc(100vh-16rem)]">
          <div className="space-y-2 p-3">
            <ItemListBody model={model} />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function ItemFilters({ model }: { model: InboxPageModel }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Select
          value={model.channel}
          onValueChange={(value) => model.setChannel(value as InboxChannelFilter)}
        >
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue placeholder="Item type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="comments">Comments</SelectItem>
            <SelectItem value="dms">Direct messages</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={model.platform}
          onValueChange={(value) => model.setPlatform(value as InboxPlatformFilter)}
        >
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          model.syncInboxMutation.mutate({
            socialAccountId: model.selectedAccountId,
            silent: false,
          })
        }
        disabled={!model.selectedAccountId || model.syncInboxMutation.isPending}
      >
        <RotateCw className="mr-1 h-4 w-4" />
        {model.syncInboxMutation.isPending ? 'Syncing…' : 'Sync'}
      </Button>
    </div>
  );
}

function ItemListBody({ model }: { model: InboxPageModel }) {
  if (model.inboxLoading) {
    return <ItemListSkeleton />;
  }
  if (model.inboxIsError) {
    return (
      <div className="space-y-3 p-3">
        <div className="text-destructive text-sm">
          Failed to load inbox items
          {model.inboxError instanceof Error ? `: ${model.inboxError.message}` : '.'}
        </div>
        <Button variant="outline" size="sm" onClick={() => model.refetchInbox()}>
          Retry
        </Button>
      </div>
    );
  }
  if (model.filteredItems.length === 0) {
    return <div className="text-muted-foreground p-6 text-sm">No items found.</div>;
  }

  return (
    <>
      {model.filteredItems.map((item) => (
        <ItemRow key={getInboxItemKey(item)} model={model} item={item} />
      ))}
    </>
  );
}

function ItemListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="rounded-md border p-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="mb-2 h-4 w-2/3" />
              <Skeleton className="h-3 w-5/6" />
            </div>
            <Skeleton className="h-5 w-10 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function InboxPageContent({ model }: { model: InboxPageModel }) {
  if (!model.brandId) {
    return <BrandRequiredCard />;
  }

  return (
    <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-12">
      <AccountList model={model} />
      <ItemList model={model} />
      <InboxDetailPanel model={model} />
    </div>
  );
}
