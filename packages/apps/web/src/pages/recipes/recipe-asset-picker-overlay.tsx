import AssetPicker from '@/features/assets/components/AssetPicker';
import type { RecipeInputField } from '@/lib/api/recipes-client';

type RecipeAssetPickerOverlayProps = {
  brandId: string | null;
  assetPickerFieldKey: string | null;
  activeAssetPickerField: RecipeInputField | null;
  onSelect: (fieldKey: string, assetIds: string[]) => void;
  onClose: () => void;
};

export function RecipeAssetPickerOverlay({
  brandId,
  assetPickerFieldKey,
  activeAssetPickerField,
  onSelect,
  onClose,
}: RecipeAssetPickerOverlayProps) {
  if (!brandId || !assetPickerFieldKey || !activeAssetPickerField) {
    return null;
  }

  return (
    <AssetPicker
      brandId={brandId}
      onSelectMany={(assets) => {
        const allIds = assets.map((asset) => asset.id).filter(Boolean);
        const allowMany = activeAssetPickerField.multiple !== false;
        const capped = allowMany ? allIds : allIds.slice(0, 1);
        const max =
          typeof activeAssetPickerField.max === 'number' && activeAssetPickerField.max > 0
            ? activeAssetPickerField.max
            : undefined;
        onSelect(assetPickerFieldKey, max ? capped.slice(0, max) : capped);
      }}
      onClose={onClose}
    />
  );
}
