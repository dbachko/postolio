import { useEffect, useState } from 'react';
import type { CreditPack } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type BrandOption = {
  id: string;
  name: string;
};

type CreditTopUpProps = {
  brands: BrandOption[];
  loading: boolean;
  onPurchase: (brandId: string, creditPack: CreditPack) => Promise<void> | void;
};

const PACKS: Array<{ id: CreditPack; title: string; credits: number; priceLabel: string }> = [
  { id: 'starter', title: 'Starter', credits: 500, priceLabel: '$5' },
  { id: 'standard', title: 'Standard', credits: 2000, priceLabel: '$20' },
  { id: 'bulk', title: 'Bulk', credits: 5000, priceLabel: '$50' },
];

export function CreditTopUp({ brands, loading, onPurchase }: CreditTopUpProps) {
  const [selectedBrandId, setSelectedBrandId] = useState('');

  useEffect(() => {
    if (!selectedBrandId && brands.length > 0) {
      setSelectedBrandId(brands[0].id);
    }
  }, [brands, selectedBrandId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI credit top-ups</CardTitle>
        <CardDescription>Buy extra credits anytime with one-time checkout.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {brands.length === 0 ? (
          <div className="text-muted-foreground text-sm">
            Create at least one brand to purchase and apply credits.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="billing-brand">
                Brand
              </label>
              <select
                id="billing-brand"
                className="bg-background w-full rounded-md border px-3 py-2 text-sm"
                value={selectedBrandId}
                onChange={(event) => setSelectedBrandId(event.target.value)}
              >
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {PACKS.map((pack) => (
                <Button
                  key={pack.id}
                  variant="outline"
                  disabled={loading || !selectedBrandId}
                  onClick={() => void onPurchase(selectedBrandId, pack.id)}
                  className="h-auto flex-col items-start gap-1 p-3 text-left"
                >
                  <span className="font-medium">{pack.title}</span>
                  <span className="text-muted-foreground text-xs">
                    {pack.credits} credits · {pack.priceLabel}
                  </span>
                </Button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default CreditTopUp;
