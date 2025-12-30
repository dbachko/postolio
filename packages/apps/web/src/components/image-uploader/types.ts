export interface ImageUploaderProps {
  value?: string;
  onChange: (url: string | File) => void;
  onUpload?: (file: File) => Promise<string>;
  className?: string;
  maxSizeInMB?: number;
  acceptedFormats?: string[];
}
