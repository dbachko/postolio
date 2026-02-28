import { Calendar, FileText, Image, Play, Video } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Asset } from '@/features/assets/api/client';
import type { Content } from '@/lib/api';

import { formatShortDateTime, getDraftPreview } from '../utils';

function getDraftMediaPresentation(
  preview: ReturnType<typeof getDraftPreview>,
  previewAlt: string
) {
  if (preview.kind === 'video') {
    return {
      label: 'Video',
      icon: <Video className="h-3 w-3" />,
      body: (
        <div className="relative h-full w-full">
          <video
            src={preview.url}
            poster={preview.posterUrl || undefined}
            className="h-full w-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-black/60 p-2">
              <Play className="h-4 w-4 text-white" />
            </div>
          </div>
        </div>
      ),
    };
  }

  if (preview.kind === 'image') {
    return {
      label: 'Image',
      icon: <Image className="h-3 w-3" />,
      body: (
        <img
          src={preview.url}
          alt={previewAlt}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ),
    };
  }

  return {
    label: 'Text',
    icon: <FileText className="h-3 w-3" />,
    body: (
      <div className="bg-muted flex h-full w-full items-center justify-center">
        <FileText className="text-muted-foreground h-8 w-8" />
      </div>
    ),
  };
}

export function DraftCard({
  draft,
  primaryAsset,
  onOpen,
}: {
  draft: Content;
  primaryAsset: Asset | null;
  onOpen: () => void;
}) {
  const preview = getDraftPreview(primaryAsset);
  const isScheduled = Boolean(draft.scheduledAt);
  const statusVariant = isScheduled ? 'info' : 'secondary';
  const statusLabel = isScheduled ? 'Scheduled' : 'Draft';
  const previewAlt = draft.caption?.trim()
    ? `${draft.caption.trim()} preview`
    : 'Draft media preview';
  const media = getDraftMediaPresentation(preview, previewAlt);

  return (
    <Button
      asChild
      variant="ghost"
      className="h-auto w-full flex-col items-stretch justify-start p-0 text-left whitespace-normal hover:bg-transparent"
    >
      <button type="button" onClick={onOpen}>
        <div className="w-full space-y-2">
          <div className="group hover:border-border/80 relative aspect-square w-full overflow-hidden rounded-lg border">
            <div className="absolute top-2 left-2 z-10">
              <Badge variant={statusVariant} className="flex items-center gap-1">
                {isScheduled ? <Calendar className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                <span>{statusLabel}</span>
              </Badge>
            </div>

            <div className="absolute top-2 right-2 z-10">
              <Badge variant="secondary" className="flex items-center gap-1">
                {media.icon}
                <span>{media.label}</span>
              </Badge>
            </div>

            {media.body}
          </div>

          <div className="space-y-1">
            <div className="line-clamp-2 text-sm font-semibold">
              {draft.caption?.trim() ? draft.caption.trim() : 'Untitled draft'}
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span>
                {isScheduled && draft.scheduledAt
                  ? `Scheduled ${formatShortDateTime(draft.scheduledAt)}`
                  : `Edited ${formatShortDateTime(draft.updatedAt || draft.createdAt)}`}
              </span>
            </div>
          </div>
        </div>
      </button>
    </Button>
  );
}
