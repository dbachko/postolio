import { analyzeText, type QuickLensResult } from '@/utils/quickLens';
import { Badge } from '@/components/ui/badge';

export function QuickLensChips({ text }: { text: string }) {
  const res: QuickLensResult = analyzeText(text || '');
  const sentimentColor =
    res.sentiment.label === 'positive'
      ? 'success'
      : res.sentiment.label === 'negative'
        ? 'destructive'
        : 'secondary';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        variant={sentimentColor as any}
        title={`Score ${res.sentiment.score} • conf ${res.sentiment.confidence}`}
      >
        {res.sentiment.label}
      </Badge>
      {res.reply.recommended && (
        <Badge variant="outline" title={res.reply.reasons.join(', ')}>
          reply suggested
        </Badge>
      )}
      {res.spam.isSpam && (
        <Badge
          variant="outline"
          className="border-border/70 text-muted-foreground"
          title={res.spam.reasons.join(', ')}
        >
          spam
        </Badge>
      )}
    </div>
  );
}
