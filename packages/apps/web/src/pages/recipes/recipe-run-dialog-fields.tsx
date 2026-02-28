import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { RecipeInputField } from '@/lib/api/recipes-client';
import { toHumanLabel } from './recipes-utils';

function AssetFieldControl({
  field,
  selectedAssetIds,
  createRunPending,
  onOpenAssetPicker,
  onClearAssetSelection,
}: {
  field: RecipeInputField;
  selectedAssetIds: string[];
  createRunPending: boolean;
  onOpenAssetPicker: (fieldKey: string) => void;
  onClearAssetSelection: (fieldKey: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenAssetPicker(field.key)}
          disabled={createRunPending}
        >
          {selectedAssetIds.length > 0
            ? `Selected ${selectedAssetIds.length} asset${selectedAssetIds.length === 1 ? '' : 's'}`
            : 'Choose assets'}
        </Button>
        {selectedAssetIds.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onClearAssetSelection(field.key)}
            disabled={createRunPending}
          >
            Clear
          </Button>
        ) : null}
      </div>
      {selectedAssetIds.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selectedAssetIds.map((assetId) => (
            <Badge key={assetId} variant="outline" className="font-mono text-xs">
              {assetId}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RunFieldControl({
  field,
  asString,
  selectedAssetIds,
  createRunPending,
  onSetInput,
  onOpenAssetPicker,
  onClearAssetSelection,
}: {
  field: RecipeInputField;
  asString: string;
  selectedAssetIds: string[];
  createRunPending: boolean;
  onSetInput: (key: string, value: unknown) => void;
  onOpenAssetPicker: (fieldKey: string) => void;
  onClearAssetSelection: (fieldKey: string) => void;
}) {
  if (field.type === 'textarea') {
    return (
      <Textarea
        value={asString}
        placeholder={field.placeholder || undefined}
        onChange={(event) => onSetInput(field.key, event.target.value)}
      />
    );
  }

  if (field.type === 'input' || field.type === 'date') {
    return (
      <Input
        type={field.type === 'date' ? 'date' : 'text'}
        value={asString}
        placeholder={field.placeholder || undefined}
        onChange={(event) => onSetInput(field.key, event.target.value)}
      />
    );
  }

  if (field.type === 'select') {
    return (
      <Select value={asString} onValueChange={(next) => onSetInput(field.key, next)}>
        <SelectTrigger>
          <SelectValue placeholder={field.placeholder || 'Choose value'} />
        </SelectTrigger>
        <SelectContent>
          {(field.options || []).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === 'asset_picker' || field.type === 'asset_reference_selector') {
    return (
      <AssetFieldControl
        field={field}
        selectedAssetIds={selectedAssetIds}
        createRunPending={createRunPending}
        onOpenAssetPicker={onOpenAssetPicker}
        onClearAssetSelection={onClearAssetSelection}
      />
    );
  }

  return null;
}

export function RunInputFieldRow({
  field,
  value,
  required,
  createRunPending,
  onSetInput,
  onOpenAssetPicker,
  onClearAssetSelection,
}: {
  field: RecipeInputField;
  value: unknown;
  required: boolean;
  createRunPending: boolean;
  onSetInput: (key: string, value: unknown) => void;
  onOpenAssetPicker: (fieldKey: string) => void;
  onClearAssetSelection: (fieldKey: string) => void;
}) {
  const asString = typeof value === 'string' ? value : '';
  const selectedAssetIds = Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter((item) => item.length > 0)
    : [];

  return (
    <div className="space-y-1">
      <Label>
        {field.label || toHumanLabel(field.key)}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <RunFieldControl
        field={field}
        asString={asString}
        selectedAssetIds={selectedAssetIds}
        createRunPending={createRunPending}
        onSetInput={onSetInput}
        onOpenAssetPicker={onOpenAssetPicker}
        onClearAssetSelection={onClearAssetSelection}
      />
      {field.description ? (
        <p className="text-muted-foreground text-xs">{field.description}</p>
      ) : null}
    </div>
  );
}
