import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsApi, type AssetType } from '@/features/assets/api/client';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { X, Upload, Loader2, Trash2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';

type SidebarLayout = 'sidebar' | 'page';

interface AssetSidebarProps {
  id?: string;
  layout?: SidebarLayout;
  onClose?: () => void;
  showHeader?: boolean;
}

interface AssetFormState {
  title: string;
  altText: string;
}

type AssetProbeResult = {
  width?: number;
  height?: number;
  duration?: number;
};

const IMAGE_UPLOAD_LIMIT = 10 * 1024 * 1024;
const VIDEO_UPLOAD_LIMIT = 500 * 1024 * 1024;

const defaultFormState: AssetFormState = {
  title: '',
  altText: '',
};

const formatBytes = (bytes?: number | null) => {
  if (!bytes || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  try {
    const date = new Date(value);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch {
    return value;
  }
};

const getFileExtension = (fileName?: string | null) => {
  if (!fileName) return 'Unknown';
  const idx = fileName.lastIndexOf('.');
  return idx > -1 ? fileName.slice(idx + 1).toUpperCase() : fileName.toUpperCase();
};

const probeImageDimensions = (file: File): Promise<AssetProbeResult> => {
  const ImageCtor = typeof window !== 'undefined' ? (window.Image as typeof Image) : undefined;
  if (!ImageCtor) {
    return Promise.resolve<AssetProbeResult>({});
  }

  return new Promise<AssetProbeResult>((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new ImageCtor();
    image.onload = () => {
      resolve({ width: image.width, height: image.height });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({});
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
};

const probeVideoMetadata = (file: File): Promise<AssetProbeResult> => {
  if (typeof document === 'undefined') {
    return Promise.resolve<AssetProbeResult>({});
  }

  return new Promise<AssetProbeResult>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        duration: Number.isFinite(video.duration) ? Math.round(video.duration) : undefined,
      });
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      resolve({});
      URL.revokeObjectURL(url);
    };
    video.src = url;
  });
};

export function AssetSidebar({
  id,
  layout = 'sidebar',
  onClose,
  showHeader = true,
}: AssetSidebarProps) {
  const { close } = useRightSidebarRouter();
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState<AssetFormState>(defaultFormState);
  const [hasChanges, setHasChanges] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);

  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: async (): Promise<AssetType> => {
      const response = await assetsApi.getAsset(id!);
      return response.asset;
    },
    enabled: Boolean(id),
    staleTime: 5_000,
  });

  const asset = assetQuery.data;

  useEffect(() => {
    if (!asset) return;
    setFormState({
      title: asset.title || '',
      altText: asset.altText || '',
    });
    setHasChanges(false);
    setPreviewUrl(null);
  }, [asset]);

  useEffect(
    () => () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl]
  );

  const mutationSuccess = (updated: AssetType) => {
    queryClient.setQueryData(['asset', updated.id], updated);
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    setFormState({
      title: updated.title || '',
      altText: updated.altText || '',
    });
    setHasChanges(false);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const updateMetadataMutation = useMutation({
    mutationFn: async (input: Partial<AssetType>) => {
      if (!id) throw new Error('Missing asset id');
      const { asset: updated } = await assetsApi.updateAsset(id, {
        title: input.title,
        altText: input.altText,
      });
      return updated;
    },
    onSuccess: (updated) => {
      mutationSuccess(updated);
      toast.success('Asset details updated');
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to update asset';
      toast.error(message);
    },
  });

  const replaceFileMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!asset) throw new Error('Asset not loaded');
      const isImage = file.type.startsWith('image/');
      const fileType = isImage ? 'image' : 'video';
      const limit = isImage ? IMAGE_UPLOAD_LIMIT : VIDEO_UPLOAD_LIMIT;
      if (file.size > limit) {
        const friendlyLimit = Math.floor(limit / (1024 * 1024));
        throw new Error(
          `Please upload ${fileType === 'image' ? 'images' : 'videos'} smaller than ${friendlyLimit}MB.`
        );
      }

      const uploadInfo = await assetsApi.getUploadUrl({
        brandId: asset.brandId,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        fileType,
        fileSize: file.size,
      });

      await assetsApi.uploadToS3(file, uploadInfo.uploadUrl);

      const dims = isImage ? await probeImageDimensions(file) : await probeVideoMetadata(file);

      const { asset: updated } = await assetsApi.updateAsset(asset.id, {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileType,
        fileSize: file.size,
        s3Key: uploadInfo.s3Key,
        width: dims.width,
        height: dims.height,
        duration: dims.duration,
      });

      return updated;
    },
    onSuccess: (updated) => {
      mutationSuccess(updated);
      toast.success('Asset file replaced');
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to replace asset file';
      toast.error(message);
    },
    onSettled: () => {
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    },
  });

  const deleteAssetMutation = useMutation({
    mutationFn: async (assetId: string) => {
      await assetsApi.deleteAsset(assetId);
      return assetId;
    },
    onSuccess: (deletedId) => {
      queryClient.removeQueries({ queryKey: ['asset', deletedId], exact: true });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      toast.success('Asset deleted');
      handleClose();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete asset';
      toast.error(message);
    },
  });

  const derivedDisplay = useMemo(() => {
    if (!asset) return null;
    return {
      fileSize: formatBytes(asset.fileSize),
      createdAt: formatDateTime(asset.createdAt),
      updatedAt: formatDateTime(asset.updatedAt),
      extension: getFileExtension(asset.fileName),
    };
  }, [asset]);

  const handleClose = () => {
    if (layout === 'sidebar') {
      close();
    } else if (onClose) {
      onClose();
    }
  };

  const handleSave = () => {
    if (!asset) return;
    updateMetadataMutation.mutate({
      title: formState.title,
      altText: formState.altText,
    });
  };

  const handleFieldChange =
    (field: keyof AssetFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setFormState((prev) => ({ ...prev, [field]: value }));
      if (!asset) return;
      setHasChanges(
        (field === 'title' ? value : formState.title) !== (asset.title || '') ||
          (field === 'altText' ? value : formState.altText) !== (asset.altText || '')
      );
    };

  const handleReset = () => {
    if (!asset) return;
    setFormState({
      title: asset.title || '',
      altText: asset.altText || '',
    });
    setHasChanges(false);
  };

  const handleUploadTrigger = () => {
    uploadInputRef.current?.click();
  };

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(nextFile);
    });
    replaceFileMutation.mutate(nextFile);
  };

  const handleDeleteAsset = () => {
    if (!asset || deleteAssetMutation.isPending) return;
    const confirmed = window.confirm('Delete this asset? This action cannot be undone.');
    if (!confirmed) return;
    deleteAssetMutation.mutate(asset.id);
  };

  const handleOpenFullPage = () => {
    if (layout === 'sidebar') {
      close();
    }
  };

  const headerClass = useMemo(
    () =>
      cn(
        'bg-card flex h-14 items-center justify-between border-b px-4',
        layout === 'sidebar' ? 'sticky top-0 z-30' : 'rounded-t'
      ),
    [layout]
  );

  const bodyClass =
    layout === 'sidebar' ? 'flex-1 overflow-y-auto px-4 py-4' : 'flex-1 overflow-y-auto px-6 py-6';

  const containerClass = useMemo(
    () => cn('flex flex-col', layout === 'sidebar' ? 'h-full shadow-lg' : 'min-h-[60vh] w-full'),
    [layout]
  );

  const assetPreviewUrl = previewUrl || asset?.url || asset?.thumbnailUrl || '';

  return (
    <div className={containerClass} role="complementary" aria-labelledby="asset-sidebar-title">
      {showHeader ? (
        <div className={headerClass}>
          {id && asset ? (
            <Breadcrumb aria-label="asset-sidebar-title">
              <BreadcrumbList>
                {layout === 'page' ? (
                  <>
                    <BreadcrumbItem>
                      <BreadcrumbLink asChild>
                        <Link to="/assets">Assets</Link>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbItem>
                      <BreadcrumbPage>{asset.title || asset.fileName}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                ) : (
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <Link to={`/assets/${asset.id}`} onClick={handleOpenFullPage}>
                        Edit Asset
                      </Link>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          ) : (
            <Breadcrumb aria-label="asset-sidebar-title">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>{asset ? 'Asset' : 'Select an asset'}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          )}
          {layout === 'sidebar' ? (
            <Button variant="ghost" size="icon" onClick={handleClose} aria-label="Close sidebar">
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className={bodyClass}>
        {assetQuery.isError ? (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
            {assetQuery.error instanceof Error ? assetQuery.error.message : 'Failed to load asset.'}
          </div>
        ) : assetQuery.isLoading ? (
          <div className="flex min-h-[240px] items-center justify-center">
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          </div>
        ) : !asset ? (
          <div className="text-muted-foreground text-sm">Select an asset to view its details.</div>
        ) : (
          <div className="space-y-8 pb-6">
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="asset-title">Asset Title</Label>
                  <Input
                    id="asset-title"
                    value={formState.title}
                    onChange={handleFieldChange('title')}
                    placeholder="Name this asset"
                  />
                  <div className="text-muted-foreground flex justify-end text-xs">
                    {formState.title.length}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="asset-alt-text">Alt Text</Label>
                  <Textarea
                    id="asset-alt-text"
                    value={formState.altText}
                    onChange={handleFieldChange('altText')}
                    placeholder="Describe the contents of the asset for accessibility"
                    rows={3}
                  />
                  <div className="text-muted-foreground flex justify-between text-xs">
                    <span>Alt text describes the contents of the asset.</span>
                    <span>{formState.altText.length}</span>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold">Preview</h3>
                  <p className="text-muted-foreground text-sm">
                    Replace the source file to update this asset
                  </p>
                </div>

                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={handleFileSelection}
                />

                <div className="border-border bg-muted/20 group relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-lg border">
                  {asset.fileType === 'video' ? (
                    <video
                      key={assetPreviewUrl}
                      controls
                      className="h-full w-full object-contain"
                      src={assetPreviewUrl}
                    />
                  ) : (
                    <img
                      src={assetPreviewUrl}
                      alt={formState.altText || asset.altText || asset.fileName}
                      className="h-full w-full object-contain"
                    />
                  )}

                  {replaceFileMutation.isPending && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 text-white">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="mt-2 text-sm">Uploading…</span>
                    </div>
                  )}

                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="pointer-events-auto flex flex-wrap justify-center gap-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleUploadTrigger}
                        disabled={replaceFileMutation.isPending || deleteAssetMutation.isPending}
                        className="shadow-lg"
                      >
                        {replaceFileMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Uploading…
                          </>
                        ) : (
                          <>
                            <Upload className="mr-2 h-4 w-4" />
                            Upload
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={handleDeleteAsset}
                        disabled={deleteAssetMutation.isPending || replaceFileMutation.isPending}
                        className="shadow-lg"
                      >
                        {deleteAssetMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Deleting…
                          </>
                        ) : (
                          <>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="rounded-lg border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  onClick={() => setDetailsOpen((prev) => !prev)}
                >
                  <span className="text-lg font-semibold">Asset Details</span>
                  <ChevronDown
                    className={cn('h-4 w-4 transition-transform', detailsOpen ? 'rotate-180' : '')}
                  />
                </button>
                {detailsOpen ? (
                  <div className="border-t px-4 pt-2 pb-4">
                    <dl className="grid grid-cols-2 gap-4 text-sm">
                      <div className="space-y-1">
                        <dt className="text-muted-foreground">Type</dt>
                        <dd className="font-medium capitalize">{asset.fileType}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-muted-foreground">Format</dt>
                        <dd className="font-medium">{derivedDisplay?.extension}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-muted-foreground">MIME Type</dt>
                        <dd className="font-medium">{asset.mimeType}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-muted-foreground">File Size</dt>
                        <dd className="font-medium">{derivedDisplay?.fileSize}</dd>
                      </div>
                      {asset.fileType === 'image' ? (
                        <div className="space-y-1">
                          <dt className="text-muted-foreground">Dimensions</dt>
                          <dd className="font-medium">
                            {asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}
                          </dd>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <dt className="text-muted-foreground">Duration</dt>
                          <dd className="font-medium">
                            {asset.duration ? `${asset.duration}s` : '—'}
                          </dd>
                        </div>
                      )}
                      <div className="space-y-1">
                        <dt className="text-muted-foreground">Uploaded</dt>
                        <dd className="font-medium">{derivedDisplay?.createdAt}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-muted-foreground">Last Updated</dt>
                        <dd className="font-medium">{derivedDisplay?.updatedAt}</dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      {asset ? (
        <div className="bg-card/50 border-t px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-sm">
              {hasChanges ? 'You have unsaved changes.' : 'Make edits and click save when ready.'}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={!hasChanges || updateMetadataMutation.isPending}
              >
                Reset
              </Button>
              <Button
                onClick={handleSave}
                disabled={!hasChanges || updateMetadataMutation.isPending}
              >
                {updateMetadataMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AssetSidebar;
