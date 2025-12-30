import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import type { PostPreviewItem } from '../types';
import { FacebookPreviewCard } from './components/facebook-preview-card';
import { GenericPreviewCard } from './components/generic-preview-card';
import { InstagramPreviewCard } from './components/instagram-preview-card';

export function PlatformPreviewCard({ item }: { item: PostPreviewItem }) {
  const { account, content, note } = item;
  const firstComment = (content.firstComment || '').trim();
  const showMeta = Boolean(note || account.disconnected);
  const showFirstComment =
    account.platform === 'instagram' && firstComment && content.contentType !== 'story';

  let preview: ReactNode;
  if (account.platform === 'instagram') {
    preview = <InstagramPreviewCard item={item} />;
  } else if (account.platform === 'facebook') {
    preview = <FacebookPreviewCard item={item} />;
  } else {
    preview = <GenericPreviewCard item={item} />;
  }

  return (
    <div className="space-y-2">
      {showMeta ? (
        <div className="flex justify-end gap-1">
          {note ? (
            <Badge variant="secondary" className="text-[10px] uppercase">
              {note}
            </Badge>
          ) : null}
          {account.disconnected ? (
            <Badge variant="outline" className="text-[10px]">
              Disconnected
            </Badge>
          ) : null}
        </div>
      ) : null}

      {preview}

      {showFirstComment ? (
        <p className="text-muted-foreground border-border bg-muted/40 line-clamp-2 rounded-lg border px-3 py-2 text-xs">
          <span className="text-foreground font-medium">First comment:</span>
          <span className="ml-1">{firstComment}</span>
        </p>
      ) : null}
    </div>
  );
}
