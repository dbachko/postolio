import type { BillingInvoice } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type InvoiceHistoryProps = {
  invoices: BillingInvoice[];
};

function toUsd(cents: number, currency: string) {
  const amount = (cents || 0) / 100;
  return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
}

export function InvoiceHistory({ invoices }: InvoiceHistoryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoice history</CardTitle>
        <CardDescription>Recent invoice records from Stripe sync.</CardDescription>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <div className="text-muted-foreground text-sm">No invoices yet.</div>
        ) : (
          <div className="space-y-2">
            {invoices.map((invoice) => (
              <div
                key={invoice.stripeInvoiceId}
                className="bg-background flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
              >
                <div className="space-y-1">
                  <div className="font-medium">{invoice.number || invoice.stripeInvoiceId}</div>
                  <div className="text-muted-foreground">
                    {new Date(invoice.createdAt).toLocaleDateString()} · {invoice.status}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="font-medium">{toUsd(invoice.total, invoice.currency)}</div>
                  {invoice.invoicePdfUrl ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={invoice.invoicePdfUrl} target="_blank" rel="noreferrer">
                        PDF
                      </a>
                    </Button>
                  ) : invoice.hostedInvoiceUrl ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                        View
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default InvoiceHistory;
