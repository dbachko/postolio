import { useEffect, useMemo, useRef, useState } from 'react';
import Uppy from '@uppy/core';
import DashboardPlugin from '@uppy/dashboard';
import AwsS3 from '@uppy/aws-s3';
import '@uppy/core/css/style.css';
import '@uppy/dashboard/css/style.css';
import { assetsApi } from '@/features/assets/api/client';
import { validateInstagramVideo } from '@/lib/instagram-video-validator';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const IMAGE_UPLOAD_LIMIT = 10 * 1024 * 1024; // 10MB
const VIDEO_UPLOAD_LIMIT = 500 * 1024 * 1024; // 500MB
const VIDEO_MIN_DURATION = 3; // seconds
const VIDEO_MAX_DURATION = 90; // seconds
const VIDEO_MIN_WIDTH = 540;
const VIDEO_MIN_HEIGHT = 960;

interface AssetUploadSidebarProps {
  id?: string; // brandId passed via sidebar router
}

export function AssetUploadSidebar({ id: brandId }: AssetUploadSidebarProps) {
  const { close } = useRightSidebarRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s3KeyById = useRef<Map<string, string>>(new Map());
  const videoMetaById = useRef<
    Map<
      string,
      {
        durationSeconds?: number;
        width?: number;
        height?: number;
        aspectRatio?: number;
        warnings?: string[];
      }
    >
  >(new Map());
  const dashboardContainerRef = useRef<HTMLDivElement | null>(null);
  const dashboardPluginRef = useRef<any>(null);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  const dropCopy = 'Drop files here or %{browseFiles}';
  const browseCopy = 'click to browse';
  const restrictionCopy =
    'Supports: JPEG, PNG, WebP, GIF (max 10MB) • Video MP4/MOV up to 500MB (3–90s recommended)';
  const pluralize = (count: number) => (count === 1 ? 0 : 1);

  const uppy = useMemo(() => {
    if (!brandId) {
      return null;
    }
    const instance = new Uppy({
      autoProceed: false,
      debug: !!import.meta.env.DEV,
      restrictions: {
        allowedFileTypes: ['image/*', 'video/*'],
      },
      locale: {
        strings: {
          dropPasteFiles: dropCopy,
          browseFiles: browseCopy,
        },
        pluralize,
      },
    });

    (instance as any).use(AwsS3, {
      shouldUseMultipart: false,
      getUploadParameters: async (file: any) => {
        const fileType = file.type?.startsWith('image/') ? 'image' : 'video';
        const limit = fileType === 'image' ? IMAGE_UPLOAD_LIMIT : VIDEO_UPLOAD_LIMIT;
        if (file.size > limit) {
          const limitMb = Math.floor(limit / (1024 * 1024));
          const friendlyType = fileType === 'image' ? 'images' : 'videos';
          const message = `Please upload ${friendlyType} smaller than ${limitMb}MB.`;
          setError(message);
          throw new Error(message);
        }

        if (fileType === 'video') {
          const validation = await validateInstagramVideo(file.data as File, {
            minDurationSeconds: VIDEO_MIN_DURATION,
            maxDurationSeconds: VIDEO_MAX_DURATION,
            minWidth: VIDEO_MIN_WIDTH,
            minHeight: VIDEO_MIN_HEIGHT,
            recommendedAspectRatios: [
              { label: '9:16', ratio: 9 / 16 },
              { label: '4:5', ratio: 4 / 5 },
            ],
          });

          videoMetaById.current.set(file.id, validation);

          if (validation.errors.length > 0) {
            const message = validation.errors.join(' ');
            setError(message);
            throw new Error(message);
          }

          if (validation.warnings.length > 0) {
            toast.warning(validation.warnings.join(' '));
          }
        }
        const res = await assetsApi.getUploadUrl({
          brandId,
          fileName: file.name,
          contentType: file.type,
          fileType,
          fileSize: file.size,
        });
        s3KeyById.current.set(file.id, res.s3Key);
        return {
          method: 'PUT',
          url: res.uploadUrl,
          headers: { 'Content-Type': file.type },
        } as any;
      },
    });

    return instance;
  }, [brandId]);

  useEffect(() => {
    if (!uppy || !brandId) {
      return;
    }
    if (dashboardContainerRef.current && !dashboardPluginRef.current) {
      const opts: any = {
        inline: true,
        target: dashboardContainerRef.current,
        width: '100%',
        height: 440,
        note: restrictionCopy,
        theme: 'auto',
        proudlyDisplayPoweredByUppy: false,
        showProgressDetails: true,
        hideUploadButton: false,
      };
      (uppy as any).use(DashboardPlugin, opts);
      dashboardPluginRef.current = (uppy as any).getPlugin('Dashboard');

      try {
        const dash = dashboardPluginRef.current as any;
        requestAnimationFrame(() => {
          dash?.setPluginState?.({ areInsidesReadyToBeVisible: true, isHidden: false });
        });
        setTimeout(() => {
          dash?.setPluginState?.({ areInsidesReadyToBeVisible: true, isHidden: false });
        }, 300);
        setTimeout(() => {
          dash?.setPluginState?.({ areInsidesReadyToBeVisible: true, isHidden: false });
        }, 1100);
      } catch {}
    }

    function inferS3KeyFromUploadURL(url?: string | null): string | undefined {
      if (!url) {
        return undefined;
      }
      try {
        const u = new URL(url);
        return decodeURIComponent(u.pathname.replace(/^\//, ''));
      } catch {
        return undefined;
      }
    }

    function probeDimensions(file: any): Promise<{ width?: number; height?: number }> {
      if (!file.type?.startsWith('image/') || !file.data) {
        return Promise.resolve({});
      }
      return new Promise((resolve) => {
        const url = URL.createObjectURL(file.data as Blob);
        const img = new Image();
        img.onload = () => {
          resolve({ width: img.width, height: img.height });
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          resolve({});
          URL.revokeObjectURL(url);
        };
        img.src = url;
      });
    }

    const onUpload = () => {
      setBusy(true);
      setError(null);
    };

    const onUploadSuccess = async (file: any) => {
      const s3Key =
        s3KeyById.current.get(file.id) ||
        inferS3KeyFromUploadURL(file?.response?.uploadURL) ||
        (file?.uploadURL ? inferS3KeyFromUploadURL(file.uploadURL) : undefined);
      if (!s3Key) {
        return;
      }
      const dims = await probeDimensions(file);
      const videoMeta = videoMetaById.current.get(file.id);
      try {
        await assetsApi.createAsset({
          brandId,
          fileName: file.name,
          s3Key,
          fileSize: file.size,
          mimeType: file.type,
          fileType: file.type?.startsWith('image/') ? 'image' : 'video',
          width: videoMeta?.width ?? dims.width,
          height: videoMeta?.height ?? dims.height,
          duration: videoMeta?.durationSeconds,
        });
        videoMetaById.current.delete(file.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to finalize asset';
        setError(message);
      }
    };

    const onComplete = async (result: any) => {
      setBusy(false);
      if (result?.successful?.length > 0) {
        toast.success('Assets uploaded');
        await queryClient.invalidateQueries({ queryKey: ['assets'] });
        closeRef.current();
      }
    };

    uppy.on('upload', onUpload);
    uppy.on('upload-success', onUploadSuccess);
    uppy.on('complete', onComplete);

    return () => {
      uppy.off('upload', onUpload);
      uppy.off('upload-success', onUploadSuccess);
      uppy.off('complete', onComplete);
      try {
        if (dashboardPluginRef.current) {
          (uppy as any).removePlugin(dashboardPluginRef.current);
          dashboardPluginRef.current = null;
        }
      } catch {}
      try {
        uppy.cancelAll();
        uppy.destroy();
      } catch {}
    };
  }, [uppy, brandId, queryClient]);

  if (!brandId) {
    return (
      <div className="flex h-full flex-col">
        <header className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold">Upload Assets</h2>
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close sidebar">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-sm">
          Select a brand to upload assets.
        </div>
      </div>
    );
  }

  return (
    <div className="pl-assets flex h-full flex-col">
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold">Upload Assets</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={close} aria-label="Close sidebar">
          <X className="h-4 w-4" />
        </Button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {error ? (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
            {error}
          </div>
        ) : null}
        <div ref={dashboardContainerRef} className="uppy-host" />
      </div>
      <footer className="border-border text-muted-foreground border-t px-4 py-3 text-xs">
        {busy ? 'Uploading files…' : 'Files upload directly to your brand asset library.'}
      </footer>
    </div>
  );
}

export default AssetUploadSidebar;
