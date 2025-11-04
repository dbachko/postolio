import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { assetsApi } from '@/features/assets/api/client';
import Uppy from '@uppy/core';
import DashboardPlugin from '@uppy/dashboard';
import AwsS3 from '@uppy/aws-s3';
import GoogleDrive from '@uppy/google-drive';
import Dropbox from '@uppy/dropbox';
import Webcam from '@uppy/webcam';
// Uppy v5 CSS is exported under the `css/` subpath via the package export map
import '@uppy/core/css/style.css';
import '@uppy/dashboard/css/style.css';

export interface UploadModalProps {
  onClose: () => void;
  brandId: string;
  onUploaded?: () => void;
}

export default function UploadModal({ onClose, brandId, onUploaded }: UploadModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s3KeyById = useRef<Map<string, string>>(new Map());
  const companionUrl = (import.meta.env.VITE_UPPY_COMPANION_URL || '').trim();
  const dashboardContainerRef = useRef<HTMLDivElement | null>(null);
  const dashboardPluginRef = useRef<any>(null);

  function inferS3KeyFromUploadURL(url?: string | null): string | undefined {
    if (!url) return undefined;
    try {
      const u = new URL(url);
      // '/bucket-key' → 'bucket-key'
      return decodeURIComponent(u.pathname.replace(/^\//, ''));
    } catch {
      return undefined;
    }
  }

  const uppy = useMemo(() => {
    const instance = new Uppy({
      autoProceed: false,
      debug: !!import.meta.env.DEV,
      restrictions: {
        allowedFileTypes: ['image/*', 'video/*'],
      },
    });

    // If a Companion URL is configured, enable remote providers and Companion-backed S3 uploads
    // Local webcam capture is always available
    instance.use(Webcam, {});
    if (companionUrl) {
      (instance as any).use(GoogleDrive, { companionUrl });
      (instance as any).use(Dropbox, { companionUrl });
      // With Companion, AwsS3 can handle remote sources server-to-server
      // In v5, pass Companion URL via `endpoint`
      (instance as any).use(AwsS3, { endpoint: companionUrl });
    } else {
      // Fallback: browser → S3 via presigned PUT from our assets API
      (instance as any).use(AwsS3, {
        shouldUseMultipart: false,
        // v5 signature includes RequestOptions second param; it's unused for presigned PUT
        getUploadParameters: async (file: any) => {
          const fileType = file.type?.startsWith('image/') ? 'image' : 'video';
          const res = await assetsApi.getUploadUrl({
            brandId,
            fileName: file.name,
            contentType: file.type,
            fileType,
          });
          s3KeyById.current.set(file.id, res.s3Key);
          return {
            method: 'PUT',
            url: res.uploadUrl,
            headers: { 'Content-Type': file.type },
          } as any;
        },
      });
    }

    return instance;
  }, [brandId, companionUrl]);

  useEffect(() => {
    // Mount Dashboard plugin inline into our container
    if (dashboardContainerRef.current && !dashboardPluginRef.current) {
      const opts: any = {
        inline: true,
        target: dashboardContainerRef.current,
        width: '100%',
        height: 440,
        theme: 'auto',
        animateOpenClose: false,
        singleFileFullScreen: false,
        note: companionUrl
          ? 'Upload from your device, Google Drive, or Dropbox.'
          : 'Upload from your device or use your camera.',
        proudlyDisplayPoweredByUppy: false,
        showProgressDetails: true,
        hideUploadButton: false,
      };
      (uppy as any).use(DashboardPlugin, opts);
      dashboardPluginRef.current = (uppy as any).getPlugin('Dashboard');

      // Workaround for inline Dashboard staying hidden (ResizeObserver timing)
      // See: https://github.com/transloadit/uppy/issues/4209
      try {
        const dash = dashboardPluginRef.current as any;
        // Nudge visibility after layout settles
        requestAnimationFrame(() => {
          dash?.setPluginState?.({ areInsidesReadyToBeVisible: true, isHidden: false });
        });
        // Also re‑nudge after a short delay in case of StrictMode re‑mounts
        setTimeout(() => {
          dash?.setPluginState?.({ areInsidesReadyToBeVisible: true, isHidden: false });
        }, 300);
        // Final guard after 1000ms (Dashboard's own fallback window)
        setTimeout(() => {
          dash?.setPluginState?.({ areInsidesReadyToBeVisible: true, isHidden: false });
        }, 1100);
      } catch {}
    }

    function probeDimensions(file: any): Promise<{ width?: number; height?: number }> {
      if (!file.type?.startsWith('image/') || !file.data) return Promise.resolve({});
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

    const onUpload = () => setBusy(true);
    const onUploadSuccess = async (file: any) => {
      // Prefer explicit key from our presign flow; otherwise infer from uploadURL (Companion flow)
      const s3Key =
        s3KeyById.current.get(file.id) ||
        inferS3KeyFromUploadURL(file?.response?.uploadURL) ||
        (file?.uploadURL ? inferS3KeyFromUploadURL(file.uploadURL) : undefined);
      if (!s3Key) return;
      const dims = await probeDimensions(file);
      try {
        await assetsApi.createAsset({
          brandId,
          fileName: file.name,
          s3Key,
          fileSize: file.size,
          mimeType: file.type,
          fileType: file.type?.startsWith('image/') ? 'image' : 'video',
          width: dims.width,
          height: dims.height,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to finalize asset');
      }
    };
    const onComplete = (result: any) => {
      setBusy(false);
      if (result?.successful?.length > 0) {
        onUploaded?.();
        onClose();
      }
    };

    uppy.on('upload', onUpload);
    uppy.on('upload-success', onUploadSuccess);
    (uppy as any).on('complete', (r: any) => onComplete(r));
    return () => {
      uppy.off('upload', onUpload);
      uppy.off('upload-success', onUploadSuccess);
      uppy.off('complete', onComplete);
      // Uninstall Dashboard plugin before destroying uppy
      try {
        if (dashboardPluginRef.current) {
          (uppy as any).removePlugin(dashboardPluginRef.current);
          dashboardPluginRef.current = null;
        }
      } catch {}
      // Properly tear down the Uppy instance
      try {
        uppy.cancelAll();
        uppy.destroy();
      } catch {
        // no-op
      }
    };
  }, [uppy, brandId, onUploaded, onClose, companionUrl]);

  return (
    <div className="pl-assets fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background w-full max-w-xl rounded-lg border p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Upload Assets</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ring-offset-background focus-visible:ring-ring hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={dashboardContainerRef}
          className="uppy-host relative"
          style={{ minHeight: 440 }}
        />

        {busy && <div className="text-foreground mt-4 text-sm">Uploading…</div>}
        {error && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive mt-4 rounded-md border p-3 text-sm">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="border-input hover:bg-accent rounded-md border px-4 py-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => uppy.upload()}
            disabled={busy}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 disabled:opacity-50"
          >
            Start Upload
          </button>
        </div>
      </div>
    </div>
  );
}
