import { useEffect, useMemo, useRef, useState } from 'react';
import Uppy from '@uppy/core';
import DashboardPlugin from '@uppy/dashboard';
import AwsS3 from '@uppy/aws-s3';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { assetsApi } from '@/features/assets/api/client';
import { validateInstagramVideo } from '@/lib/instagram-video-validator';

const IMAGE_UPLOAD_LIMIT = 10 * 1024 * 1024; // 10MB
const VIDEO_UPLOAD_LIMIT = 500 * 1024 * 1024; // 500MB
const VIDEO_MIN_DURATION = 3; // seconds
const VIDEO_MAX_DURATION = 90; // seconds
const VIDEO_MIN_WIDTH = 540;
const VIDEO_MIN_HEIGHT = 960;

type VideoValidationMeta = {
  durationSeconds?: number;
  width?: number;
  height?: number;
  aspectRatio?: number;
  warnings?: string[];
};

function inferS3KeyFromUploadURL(url?: string | null): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const parsedUrl = new URL(url);
    return decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
  } catch {
    return undefined;
  }
}

function probeDimensions(file: {
  type?: string;
  data?: Blob;
}): Promise<{ width?: number; height?: number }> {
  const data = file.data;
  if (!file.type?.startsWith('image/') || !data) {
    return Promise.resolve({});
  }
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(data);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.width, height: image.height });
      URL.revokeObjectURL(objectUrl);
    };
    image.onerror = () => {
      resolve({});
      URL.revokeObjectURL(objectUrl);
    };
    image.src = objectUrl;
  });
}

function scheduleDashboardVisibility(dashboardPlugin: any) {
  try {
    requestAnimationFrame(() => {
      dashboardPlugin?.setPluginState?.({ areInsidesReadyToBeVisible: true, isHidden: false });
    });
    setTimeout(() => {
      dashboardPlugin?.setPluginState?.({ areInsidesReadyToBeVisible: true, isHidden: false });
    }, 300);
    setTimeout(() => {
      dashboardPlugin?.setPluginState?.({ areInsidesReadyToBeVisible: true, isHidden: false });
    }, 1100);
  } catch {
    // No-op: dashboard visibility tweaks are best-effort.
  }
}

function ensureDashboardPlugin({
  dashboardContainerRef,
  dashboardPluginRef,
  uppy,
}: {
  dashboardContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  dashboardPluginRef: React.MutableRefObject<any>;
  uppy: Uppy;
}) {
  if (!dashboardContainerRef.current || dashboardPluginRef.current) {
    return;
  }
  (uppy as any).use(DashboardPlugin, {
    inline: true,
    target: dashboardContainerRef.current,
    width: '100%',
    height: 440,
    note: 'Supports: JPEG, PNG, WebP, GIF (max 10MB) • Video MP4/MOV up to 500MB (3–90s recommended)',
    theme: 'auto',
    proudlyDisplayPoweredByUppy: false,
    showProgressDetails: true,
    hideUploadButton: false,
  } as any);
  dashboardPluginRef.current = (uppy as any).getPlugin('Dashboard');
  scheduleDashboardVisibility(dashboardPluginRef.current);
}

function resolveUploadedFileS3Key(
  file: any,
  s3KeyById: React.MutableRefObject<Map<string, string>>
) {
  return (
    s3KeyById.current.get(file.id) ||
    inferS3KeyFromUploadURL(file?.response?.uploadURL) ||
    (file?.uploadURL ? inferS3KeyFromUploadURL(file.uploadURL) : undefined)
  );
}

async function finalizeUploadedAsset(params: {
  brandId: string;
  file: any;
  s3KeyById: React.MutableRefObject<Map<string, string>>;
  videoMetaById: React.MutableRefObject<Map<string, VideoValidationMeta>>;
  setError: (value: string | null) => void;
}) {
  const s3Key = resolveUploadedFileS3Key(params.file, params.s3KeyById);
  if (!s3Key) {
    return;
  }

  const dimensions = await probeDimensions(params.file);
  const videoMeta = params.videoMetaById.current.get(params.file.id);
  try {
    await assetsApi.createAsset({
      brandId: params.brandId,
      fileName: params.file.name,
      s3Key,
      fileSize: params.file.size,
      mimeType: params.file.type,
      fileType: params.file.type?.startsWith('image/') ? 'image' : 'video',
      width: videoMeta?.width ?? dimensions.width,
      height: videoMeta?.height ?? dimensions.height,
      duration: videoMeta?.durationSeconds,
    });
    params.videoMetaById.current.delete(params.file.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to finalize asset';
    params.setError(message);
  }
}

function createUploadHandlers({
  brandId,
  closeRef,
  queryClient,
  s3KeyById,
  setBusy,
  setError,
  videoMetaById,
}: {
  brandId: string;
  closeRef: React.MutableRefObject<() => void>;
  queryClient: QueryClient;
  s3KeyById: React.MutableRefObject<Map<string, string>>;
  setBusy: (next: boolean) => void;
  setError: (value: string | null) => void;
  videoMetaById: React.MutableRefObject<Map<string, VideoValidationMeta>>;
}) {
  const onUpload = () => {
    setBusy(true);
    setError(null);
  };

  const onUploadSuccess = async (file: any) => {
    await finalizeUploadedAsset({ brandId, file, s3KeyById, videoMetaById, setError });
  };

  const onComplete = async (result: any) => {
    setBusy(false);
    if (!result?.successful?.length) {
      return;
    }
    toast.success('Assets uploaded');
    await queryClient.invalidateQueries({ queryKey: ['assets'] });
    closeRef.current();
  };

  return { onComplete, onUpload, onUploadSuccess };
}

function useAssetUploadUppy({
  brandId,
  setError,
  s3KeyById,
  videoMetaById,
}: {
  brandId?: string;
  setError: (value: string | null) => void;
  s3KeyById: React.MutableRefObject<Map<string, string>>;
  videoMetaById: React.MutableRefObject<Map<string, VideoValidationMeta>>;
}) {
  return useMemo(() => {
    if (!brandId) {
      return null;
    }

    const uppyInstance = new Uppy({
      autoProceed: false,
      debug: !!import.meta.env.DEV,
      restrictions: { allowedFileTypes: ['image/*', 'video/*'] },
      locale: {
        strings: {
          dropPasteFiles: 'Drop files here or %{browseFiles}',
          browseFiles: 'click to browse',
        },
        pluralize: (count: number) => (count === 1 ? 0 : 1),
      },
    });

    (uppyInstance as any).use(AwsS3, {
      shouldUseMultipart: false,
      getUploadParameters: async (file: any) => {
        const fileType = file.type?.startsWith('image/') ? 'image' : 'video';
        const uploadLimit = fileType === 'image' ? IMAGE_UPLOAD_LIMIT : VIDEO_UPLOAD_LIMIT;
        if (file.size > uploadLimit) {
          const limitMb = Math.floor(uploadLimit / (1024 * 1024));
          const message = `Please upload ${fileType === 'image' ? 'images' : 'videos'} smaller than ${limitMb}MB.`;
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

        const uploadInfo = await assetsApi.getUploadUrl({
          brandId,
          fileName: file.name,
          contentType: file.type,
          fileType,
          fileSize: file.size,
        });
        s3KeyById.current.set(file.id, uploadInfo.s3Key);
        return {
          method: 'PUT',
          url: uploadInfo.uploadUrl,
          headers: { 'Content-Type': file.type },
        } as any;
      },
    });

    return uppyInstance;
  }, [brandId, setError, s3KeyById, videoMetaById]);
}

function useAssetUploadLifecycle({
  brandId,
  closeRef,
  dashboardContainerRef,
  dashboardPluginRef,
  queryClient,
  setBusy,
  setError,
  s3KeyById,
  uppy,
  videoMetaById,
}: {
  brandId?: string;
  closeRef: React.MutableRefObject<() => void>;
  dashboardContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  dashboardPluginRef: React.MutableRefObject<any>;
  queryClient: QueryClient;
  setBusy: (next: boolean) => void;
  setError: (value: string | null) => void;
  s3KeyById: React.MutableRefObject<Map<string, string>>;
  uppy: Uppy | null;
  videoMetaById: React.MutableRefObject<Map<string, VideoValidationMeta>>;
}) {
  useEffect(() => {
    if (!uppy || !brandId) {
      return;
    }

    ensureDashboardPlugin({ dashboardContainerRef, dashboardPluginRef, uppy });

    const handlers = createUploadHandlers({
      brandId,
      closeRef,
      queryClient,
      s3KeyById,
      setBusy,
      setError,
      videoMetaById,
    });

    uppy.on('upload', handlers.onUpload);
    uppy.on('upload-success', handlers.onUploadSuccess);
    uppy.on('complete', handlers.onComplete);

    return () => {
      uppy.off('upload', handlers.onUpload);
      uppy.off('upload-success', handlers.onUploadSuccess);
      uppy.off('complete', handlers.onComplete);
      try {
        if (dashboardPluginRef.current) {
          (uppy as any).removePlugin(dashboardPluginRef.current);
          dashboardPluginRef.current = null;
        }
      } catch {
        // No-op on teardown.
      }
      try {
        uppy.cancelAll();
        uppy.destroy();
      } catch {
        // No-op on teardown.
      }
    };
  }, [
    brandId,
    closeRef,
    dashboardContainerRef,
    dashboardPluginRef,
    queryClient,
    setBusy,
    setError,
    s3KeyById,
    uppy,
    videoMetaById,
  ]);
}

export function useAssetUploadSidebarController(brandId: string | undefined, close: () => void) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s3KeyById = useRef<Map<string, string>>(new Map());
  const videoMetaById = useRef<Map<string, VideoValidationMeta>>(new Map());
  const dashboardContainerRef = useRef<HTMLDivElement | null>(null);
  const dashboardPluginRef = useRef<any>(null);
  const closeRef = useRef(close);

  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  const uppy = useAssetUploadUppy({ brandId, setError, s3KeyById, videoMetaById });
  useAssetUploadLifecycle({
    brandId,
    closeRef,
    dashboardContainerRef,
    dashboardPluginRef,
    queryClient,
    setBusy,
    setError,
    s3KeyById,
    uppy,
    videoMetaById,
  });

  return { busy, dashboardContainerRef, error };
}
