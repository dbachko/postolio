import { useState } from 'react';

export function usePostEditorUiState() {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [slotPickerOpen, setSlotPickerOpen] = useState(false);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [assetPickerTarget, setAssetPickerTarget] = useState<'destination' | 'template'>(
    'destination'
  );

  return {
    previewOpen,
    setPreviewOpen,
    slotPickerOpen,
    setSlotPickerOpen,
    showAssetPicker,
    setShowAssetPicker,
    assetPickerTarget,
    setAssetPickerTarget,
  };
}
