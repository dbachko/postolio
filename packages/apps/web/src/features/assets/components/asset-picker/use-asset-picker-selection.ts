import { useCallback, useMemo, useState } from 'react';
import type { AssetType } from '@/features/assets/api/client';

interface UseAssetPickerSelectionArgs {
  onSelect?: (asset: AssetType) => void;
  onSelectMany?: (assets: AssetType[]) => void;
  onClose: () => void;
}

export function useAssetPickerSelection({
  onSelect,
  onSelectMany,
  onClose,
}: UseAssetPickerSelectionArgs) {
  const [selected, setSelected] = useState<Map<string, AssetType>>(new Map());
  const selectedAssets = useMemo(() => Array.from(selected.values()), [selected]);

  const handleConfirm = useCallback(
    (assetsOverride?: AssetType[]) => {
      const assetsToSend = assetsOverride ?? selectedAssets;
      if (assetsToSend.length === 0) {
        return;
      }
      if (onSelectMany) {
        onSelectMany(assetsToSend);
      } else if (onSelect) {
        assetsToSend.forEach((asset) => onSelect(asset));
      }
      setSelected(new Map());
      onClose();
    },
    [onClose, onSelect, onSelectMany, selectedAssets]
  );

  const handleSelectAsset = useCallback((asset: AssetType) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(asset.id)) {
        next.delete(asset.id);
      } else {
        next.set(asset.id, asset);
      }
      return next;
    });
  }, []);

  const handleAssetDoubleClick = useCallback(
    (asset: AssetType) => {
      setSelected(new Map([[asset.id, asset]]));
      handleConfirm([asset]);
    },
    [handleConfirm]
  );

  return {
    selected,
    selectedAssets,
    handleConfirm,
    handleSelectAsset,
    handleAssetDoubleClick,
  };
}
