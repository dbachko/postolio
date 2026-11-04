export type CalendarPostStatus =
  'draft' | 'scheduled' | 'published' | 'failed' | 'skipped' | 'placeholder' | string;

export function getPostStatusTextClass(status: CalendarPostStatus): string {
  switch (status) {
    case 'published':
      return 'text-success';
    case 'scheduled':
      return 'text-info';
    case 'placeholder':
    case 'skipped':
      return 'text-warning';
    case 'failed':
      return 'text-destructive';
    case 'draft':
    default:
      return 'text-muted-foreground';
  }
}

export function getPostStatusBorderColor(status: CalendarPostStatus): string {
  if (status === 'failed') {
    return 'var(--destructive)';
  }
  if (status === 'published') {
    return 'var(--success)';
  }
  if (status === 'scheduled') {
    return 'var(--info)';
  }
  if (status === 'placeholder' || status === 'skipped') {
    return 'color-mix(in oklch, var(--warning) 55%, var(--border))';
  }
  return 'var(--border)';
}
