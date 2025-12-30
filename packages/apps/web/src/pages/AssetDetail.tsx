import { useParams } from 'react-router-dom';
import { AssetSidebar } from '@/right-sidebar/asset-sidebar';
import { PageHeader } from '@/components/page-header';

export default function AssetDetail() {
  const { assetId } = useParams<{ assetId: string }>();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit Asset"
        description="Review metadata, adjust titles or alt text, and replace the source file."
      />
      <div className="bg-card border-border rounded-lg border p-0">
        <AssetSidebar id={assetId} layout="page" showHeader={false} />
      </div>
    </div>
  );
}
