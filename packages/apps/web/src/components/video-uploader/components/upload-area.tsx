import { Upload } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { UploadProgress } from '@/lib/api/video-client';

interface UploadAreaProps {
  isDragging: boolean;
  isUploading: boolean;
  uploadProgress: UploadProgress | null;
  maxSizeInMB: number;
  headline?: string;
  subtext?: string;
  onClick: () => void;
}

export function UploadArea({
  isDragging,
  isUploading,
  uploadProgress,
  maxSizeInMB,
  headline,
  subtext,
  onClick,
}: UploadAreaProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'relative cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-all',
        isDragging ? 'border-ring bg-muted' : 'border-border hover:border-foreground/30 border',
        isUploading && 'cursor-not-allowed opacity-50'
      )}
    >
      <div className="flex flex-col items-center space-y-4">
        {isUploading ? (
          <>
            <div className="border-foreground h-10 w-10 animate-spin rounded-full border-b-2" />
            <p className="text-muted-foreground text-sm">
              Uploading video... {uploadProgress?.percentage || 0}%
            </p>
            {uploadProgress && (
              <div className="w-full max-w-xs">
                <Progress value={uploadProgress.percentage} className="h-2" />
                <p className="text-muted-foreground mt-2 text-xs">
                  Part {uploadProgress.uploadedParts} of {uploadProgress.totalParts}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <Upload className="text-muted-foreground h-8 w-8" />
            <div>
              <p className="text-foreground text-sm font-medium">
                {headline || 'Drop your video here or click to browse'}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {subtext || `Supports: MP4, MOV, MPEG (max ${maxSizeInMB}MB)`}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
