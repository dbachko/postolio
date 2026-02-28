import { X } from 'lucide-react';
import '@uppy/core/css/style.css';
import '@uppy/dashboard/css/style.css';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { Button } from '@/components/ui/button';
import { useAssetUploadSidebarController } from './asset-upload-sidebar-uploader';

interface AssetUploadSidebarProps {
  id?: string;
}

function AssetUploadSidebarHeader({ onClose }: { onClose: () => void }) {
  return (
    <header className="border-border flex items-center justify-between border-b px-4 py-3">
      <h2 className="text-lg font-semibold">Upload Assets</h2>
      <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close sidebar">
        <X className="h-4 w-4" />
      </Button>
    </header>
  );
}

function AssetUploadSidebarEmptyState({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <AssetUploadSidebarHeader onClose={onClose} />
      <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-sm">
        Select a brand to upload assets.
      </div>
    </div>
  );
}

function AssetUploadSidebarContent({
  busy,
  dashboardContainerRef,
  error,
}: {
  busy: boolean;
  dashboardContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  error: string | null;
}) {
  return (
    <>
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
    </>
  );
}

export function AssetUploadSidebar({ id: brandId }: AssetUploadSidebarProps) {
  const { close } = useRightSidebarRouter();
  const { busy, dashboardContainerRef, error } = useAssetUploadSidebarController(brandId, close);

  if (!brandId) {
    return <AssetUploadSidebarEmptyState onClose={close} />;
  }

  return (
    <div className="pl-assets flex h-full flex-col">
      <AssetUploadSidebarHeader onClose={close} />
      <AssetUploadSidebarContent
        busy={busy}
        dashboardContainerRef={dashboardContainerRef}
        error={error}
      />
    </div>
  );
}

export default AssetUploadSidebar;
