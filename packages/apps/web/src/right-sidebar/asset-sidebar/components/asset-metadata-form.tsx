import type { ChangeEvent } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type AssetMetadataFormProps = {
  title: string;
  altText: string;
  onTitleChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAltTextChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
};

export function AssetMetadataForm({
  title,
  altText,
  onTitleChange,
  onAltTextChange,
}: AssetMetadataFormProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="asset-title">Asset Title</Label>
        <Input
          id="asset-title"
          value={title}
          onChange={onTitleChange}
          placeholder="Name this asset"
        />
        <div className="text-muted-foreground flex justify-end text-xs">{title.length}</div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="asset-alt-text">Alt Text</Label>
        <Textarea
          id="asset-alt-text"
          value={altText}
          onChange={onAltTextChange}
          placeholder="Describe the contents of the asset for accessibility"
          rows={3}
        />
        <div className="text-muted-foreground flex justify-between text-xs">
          <span>Alt text describes the contents of the asset.</span>
          <span>{altText.length}</span>
        </div>
      </div>
    </div>
  );
}
