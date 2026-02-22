import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Image as ImageIcon, Pencil, Play, Sparkles, Video } from 'lucide-react';
import { formatBytes } from './asset-utils';
import type { AssetType } from '@/features/assets/api/client';

interface AssetCardProps {
  asset: AssetType;
  selected: boolean;
  onToggle: (opts?: { shiftKey?: boolean }) => void;
  onOpen: () => void;
  onCreatePost: () => void;
}

export function AssetCard({ asset, selected, onToggle, onOpen, onCreatePost }: AssetCardProps) {
  const isVideo = asset.fileType === 'video';
  const previewUrl = asset.thumbnailUrl || asset.url;

  return (
    <div
      className={cn(
        'group relative aspect-square overflow-hidden rounded-lg border',
        selected ? 'ring-primary border-primary ring-2 ring-offset-2' : 'hover:border-border/80'
      )}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.preventDefault();
        onToggle({ shiftKey: event.shiftKey });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle({ shiftKey: event.shiftKey });
        }
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        onOpen();
      }}
    >
      <div className="bg-card/80 absolute top-2 left-2 z-10 rounded-md px-1 py-1 shadow-sm backdrop-blur">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggle()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={selected ? 'Deselect asset' : 'Select asset'}
        />
      </div>

      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        <Badge variant="secondary" className="flex items-center gap-1">
          {isVideo ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
          <span className="capitalize">{asset.fileType}</span>
        </Badge>
      </div>

      {isVideo ? (
        <div className="relative h-full w-full">
          <video src={previewUrl} className="h-full w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-black/60 p-2">
              <Play className="h-4 w-4 text-white" />
            </div>
          </div>
        </div>
      ) : (
        <img
          src={previewUrl}
          alt={asset.altText || asset.fileName}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-black/60 to-transparent px-3 pt-12 pb-3 text-white opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex min-w-0 flex-col gap-1 text-left">
          <div className="line-clamp-1 text-sm font-semibold">{asset.title || asset.fileName}</div>
          <div className="text-xs text-white/80">{formatBytes(asset.fileSize)}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpen();
            }}
            title="Edit details"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCreatePost();
            }}
            title="Create post with this asset"
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
