// Type declarations for Module Federation remote components

declare module 'assetLibrary/AssetLibrary' {
  const AssetLibrary: React.ComponentType;
  export default AssetLibrary;
}

declare module 'assetLibrary/AssetPicker' {
  interface AssetPickerProps {
    onSelect: (assetId: string) => void;
    onClose: () => void;
    brandId: string;
  }
  const AssetPicker: React.ComponentType<AssetPickerProps>;
  export default AssetPicker;
}

declare module 'assetLibrary/UploadModal' {
  interface UploadModalProps {
    onClose: () => void;
    brandId: string;
  }
  const UploadModal: React.ComponentType<UploadModalProps>;
  export default UploadModal;
}
