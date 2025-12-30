export interface AssetReference {
  id: string;
  url: string;
  type?: 'image' | 'video';
}

export interface MultiImageUploaderProps {
  value: AssetReference[];
  onChange: (assets: AssetReference[]) => void;
  brandId: string;
  className?: string;
  maxImages?: number;
  maxSizeInMB?: number;
  enableUpload?: boolean;
  onChooseFromAssets?: () => void;
  videoUrl?: string;
  onVideoChange?: (url: string) => void;
  maxVideoSizeInMB?: number;
  acceptedVideoFormats?: string[];
  allowMixedMedia?: boolean;
}

export interface MediaItem {
  id?: string;
  url: string;
  file?: File;
  uploading?: boolean;
  type: 'image' | 'video';
  progressPercent?: number;
}
