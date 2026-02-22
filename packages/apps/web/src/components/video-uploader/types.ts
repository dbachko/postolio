export interface VideoUploaderProps {
  value?: string;
  onChange: (url: string, meta?: { assetId?: string; key?: string }) => void;
  brandId: string;
  className?: string;
  maxSizeInMB?: number;
  acceptedFormats?: string[];
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  allowedAspectRatios?: Array<{ label: string; width: number; height: number }>;
  headline?: string;
  subtext?: string;
}
