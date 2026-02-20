import type { ChangeEvent } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type AssetMetadataFormProps = {
  title: string;
  description: string;
  altText: string;
  onTitleChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDescriptionChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onAltTextChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
};

export function AssetMetadataForm({
  title,
  description,
  altText,
  onTitleChange,
  onDescriptionChange,
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

      <div className="space-y-2">
        <Label htmlFor="asset-description">Notes</Label>
        <Textarea
          id="asset-description"
          value={description}
          onChange={onDescriptionChange}
          placeholder="Add notes or context for this asset"
          rows={3}
        />
        <div className="text-muted-foreground flex justify-end text-xs">{description.length}</div>
      </div>
    </div>
  );
}
