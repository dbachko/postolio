import { EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { getPlatformConfig } from '@/lib/platform-config';
import { cn } from '@/lib/utils';
import { PlatformPreviewCard } from '../platform-preview-card';
import type { PostPreviewItem } from '../types';

interface PostPreviewPanelProps {
  layout: 'sidebar' | 'page';
  open: boolean;
  onOpenChange: (next: boolean) => void;
  items: PostPreviewItem[];
  className?: string;
  unstyled?: boolean;
}

export function PostPreviewPanel({
  layout,
  open,
  onOpenChange,
  items,
  className,
  unstyled = false,
}: PostPreviewPanelProps) {
  if (!open && layout === 'page') return null;

  const previewTitle = (() => {
    if (items.length === 0) return 'No preview';
    if (items.length > 1) return 'All destinations';
    const account = items[0]?.account;
    if (!account) return 'Preview';
    const label = (account.label || '').trim();
    if (label) {
      return account.platform === 'instagram' && label.startsWith('@') ? label.slice(1) : label;
    }
    const avatarName = (account.avatarName || '').trim();
    if (avatarName) {
      return account.platform === 'instagram' && avatarName.startsWith('@')
        ? avatarName.slice(1)
        : avatarName;
    }
    return getPlatformConfig(account.platform).displayName;
  })();

  const containerClass = cn(
    'bg-card border-border flex min-w-0 flex-col',
    layout === 'sidebar' ? 'w-[360px] shrink-0 border-l' : 'mt-4 rounded-lg border',
    className
  );

  const content = items.length ? (
    <div className={cn('space-y-3', unstyled ? 'pb-4' : 'p-3')}>
      {items.map((item) => (
        <div
          key={`${item.account.id}:${item.account.platform}`}
          className="mx-auto w-full max-w-[360px]"
        >
          <PlatformPreviewCard item={item} />
        </div>
      ))}
    </div>
  ) : (
    <div className={unstyled ? 'py-6' : 'p-4'}>
      <Empty className="min-h-[240px] rounded-none border-0 bg-none">
        <EmptyMedia>
          <EyeOff className="h-5 w-5" />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>No preview yet</EmptyTitle>
          <EmptyDescription>
            Select a destination and add media to see a live preview.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );

  const header = unstyled ? (
    <div className="bg-card border-border sticky top-0 z-20 -mx-4 mb-3 h-12 border-b px-4">
      <div className="flex h-full items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs leading-none font-medium">Preview</div>
          <div className="text-foreground truncate text-sm leading-tight font-semibold">
            {previewTitle}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            aria-label="Hide preview"
          >
            <EyeOff className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  ) : (
    <div className="border-border flex h-12 items-center justify-between border-b px-4">
      <div className="text-foreground text-sm font-semibold">Preview</div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => onOpenChange(false)}
        aria-label="Hide preview"
      >
        <EyeOff className="h-4 w-4" />
      </Button>
    </div>
  );

  const body =
    layout === 'sidebar' ? (
      <ScrollArea className="flex-1">{content}</ScrollArea>
    ) : (
      <div className="flex-1">{content}</div>
    );

  if (unstyled) {
    return (
      <>
        {header}
        <div className="flex-1">{content}</div>
      </>
    );
  }

  return (
    <div className={containerClass}>
      {header}
      {body}
    </div>
  );
}
