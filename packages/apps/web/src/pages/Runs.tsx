import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { useBrandStore } from '@/stores/brandStore';
import { AppEmptyState } from '@/components/app-empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { runs as runsApi } from '@/lib/api';
import type { RunStatus } from '@/lib/api/runs-client';

function statusBadgeVariant(
  status: RunStatus
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'success') return 'secondary';
  if (status === 'failed') return 'destructive';
  if (status === 'running' || status === 'queued') return 'outline';
  return 'outline';
}

export function Runs() {
  const { selectedBrand } = useBrandStore();
  const brandId = selectedBrand?.id ?? null;
  const navigate = useNavigate();

  const runsQuery = useQuery({
    queryKey: ['runs', brandId],
    enabled: Boolean(brandId),
    queryFn: async () => {
      const res = await runsApi.listRuns({ brandId: brandId!, limit: 50 });
      return res.runs;
    },
  });

  const runs = runsQuery.data ?? [];

  const empty = useMemo(() => runs.length === 0, [runs.length]);

  if (!selectedBrand) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AppEmptyState
          variant="minimal"
          title="Select a brand to view runs"
          description="Choose which brand you want to inspect."
          actions={[{ label: 'Choose Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-semibold">Runs</h1>
        <p className="text-muted-foreground text-sm">Execution history for {selectedBrand.name}.</p>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-base">Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          {empty ? (
            <div className="text-muted-foreground text-sm">No runs yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Recipe</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/runs/${r.id}`)}
                  >
                    <TableCell>
                      <Badge variant={statusBadgeVariant(r.status)}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-foreground">{r.recipe?.name || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{r.trigger}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
