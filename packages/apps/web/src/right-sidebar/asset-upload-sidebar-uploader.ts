import { useEffect, useRef, useState } from 'react';
import Uppy from '@uppy/core';
import DashboardPlugin from '@uppy/dashboard';
import AwsS3 from '@uppy/aws-s3';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
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

type DashboardTheme = 'light' | 'dark';

function installDashboard(uppy: Uppy, target: HTMLElement, theme: DashboardTheme) {
  (uppy as any).use(DashboardPlugin, {
    inline: true,
    target,
    width: '100%',
    height: 440,
    note: 'Supports: JPEG, PNG, WebP, GIF (max 10MB) • Video MP4/MOV up to 500MB (3–90s recommended)',
    theme,
    proudlyDisplayPoweredByUppy: false,
    showProgressDetails: true,
    hideUploadButton: false,
  } as any);
  scheduleDashboardVisibility((uppy as any).getPlugin('Dashboard'));
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

async function prepareAssetUpload(params: {
  brandId: string;
  file: any;
  setError: (value: string | null) => void;
  s3KeyById: React.MutableRefObject<Map<string, string>>;
  videoMetaById: React.MutableRefObject<Map<string, VideoValidationMeta>>;
}) {
  const fileType = params.file.type?.startsWith('image/') ? 'image' : 'video';
  const uploadLimit = fileType === 'image' ? IMAGE_UPLOAD_LIMIT : VIDEO_UPLOAD_LIMIT;
  if (params.file.size > uploadLimit) {
    const limitMb = Math.floor(uploadLimit / (1024 * 1024));
    const message = `Please upload ${fileType === 'image' ? 'images' : 'videos'} smaller than ${limitMb}MB.`;
    params.setError(message);
    throw new Error(message);
  }

  if (fileType === 'video') {
    const validation = await validateInstagramVideo(params.file.data as File, {
      minDurationSeconds: VIDEO_MIN_DURATION,
      maxDurationSeconds: VIDEO_MAX_DURATION,
      minWidth: VIDEO_MIN_WIDTH,
      minHeight: VIDEO_MIN_HEIGHT,
      recommendedAspectRatios: [
        { label: '9:16', ratio: 9 / 16 },
        { label: '4:5', ratio: 4 / 5 },
      ],
    });
    params.videoMetaById.current.set(params.file.id, validation);
    if (validation.errors.length > 0) {
      const message = validation.errors.join(' ');
      params.setError(message);
      throw new Error(message);
    }
    if (validation.warnings.length > 0) {
      toast.warning(validation.warnings.join(' '));
    }
  }

  const uploadInfo = await assetsApi.getUploadUrl({
    brandId: params.brandId,
    fileName: params.file.name,
    contentType: params.file.type,
    fileType,
    fileSize: params.file.size,
  });
  params.s3KeyById.current.set(params.file.id, uploadInfo.s3Key);
  return uploadInfo;
}

/**
 * Uppy needs an object key synchronously, but ours comes from the assets API together with
 * the presigned URL. Request the key by file id, then swap in the real key when signing.
 */
export function configureAssetUploadPlugin(
  uppy: Uppy,
  params: {
    brandId: string;
    setError: (value: string | null) => void;
    s3KeyById: React.MutableRefObject<Map<string, string>>;
    videoMetaById: React.MutableRefObject<Map<string, VideoValidationMeta>>;
  }
) {
  uppy.use(AwsS3, {
    shouldUseMultipart: false,
    generateObjectKey: (file) => file.id,
    signRequest: async (request) => {
      if (request.method !== 'PUT') {
        throw new Error(`Unsupported S3 request for asset upload: ${request.method}`);
      }
      const file = uppy.getFile(request.key);
      const { uploadUrl, s3Key } = await prepareAssetUpload({ ...params, file });
      return {
        url: uploadUrl,
        key: s3Key,
        headers: { 'Content-Type': file.type },
      };
    },
  });
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

  const pendingAssets = new Set<Promise<void>>();

  const onUploadSuccess = (file: any) => {
    const pending = finalizeUploadedAsset({ brandId, file, s3KeyById, videoMetaById, setError });
    pendingAssets.add(pending);
    void pending.finally(() => pendingAssets.delete(pending));
  };

  const onComplete = async (result: any) => {
    // Uppy does not wait for upload-success handlers; the list must not refresh before these.
    await Promise.allSettled(pendingAssets);
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

function createAssetUploadUppy() {
  return new Uppy({
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
}

function useAssetUploadLifecycle({
  brandId,
  closeRef,
  dashboardContainerRef,
  queryClient,
  setBusy,
  setError,
  s3KeyById,
  theme,
  videoMetaById,
}: {
  brandId?: string;
  closeRef: React.MutableRefObject<() => void>;
  dashboardContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  queryClient: QueryClient;
  setBusy: (next: boolean) => void;
  setError: (value: string | null) => void;
  s3KeyById: React.MutableRefObject<Map<string, string>>;
  theme: DashboardTheme;
  videoMetaById: React.MutableRefObject<Map<string, VideoValidationMeta>>;
}) {
  const uppyRef = useRef<Uppy | null>(null);
  const themeRef = useRef(theme);

  useEffect(() => {
    themeRef.current = theme;
    uppyRef.current?.getPlugin('Dashboard')?.setOptions({ theme } as any);
  }, [theme]);

  // destroy() cannot be undone, so the instance must be created here rather than in render:
  // an effect re-run (StrictMode, brand switch) needs a new one.
  useEffect(() => {
    if (!brandId || !dashboardContainerRef.current) {
      return;
    }

    const uppy = createAssetUploadUppy();
    uppyRef.current = uppy;
    configureAssetUploadPlugin(uppy, { brandId, setError, s3KeyById, videoMetaById });
    installDashboard(uppy, dashboardContainerRef.current, themeRef.current);

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
      uppyRef.current = null;
      uppy.cancelAll();
      uppy.destroy();
    };
  }, [
    brandId,
    closeRef,
    dashboardContainerRef,
    queryClient,
    setBusy,
    setError,
    s3KeyById,
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
  const closeRef = useRef(close);

  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  const { resolvedTheme } = useTheme();
  useAssetUploadLifecycle({
    brandId,
    closeRef,
    dashboardContainerRef,
    queryClient,
    setBusy,
    setError,
    s3KeyById,
    theme: resolvedTheme === 'dark' ? 'dark' : 'light',
    videoMetaById,
  });

  return { busy, dashboardContainerRef, error };
}
