interface Point {
  date: string;
  value: number;
}

export function TimeSeriesChart({
  title,
  series,
  label = 'Value',
}: {
  title: string;
  series: Point[];
  label?: string;
}) {
  if (!series || series.length === 0) {
    return (
      <div className="bg-card rounded-lg p-6 shadow-md">
        <h3 className="mb-4 text-lg font-semibold">{title}</h3>
        <div className="text-muted-foreground py-8 text-center">No data available</div>
      </div>
    );
  }
  const max = Math.max(...series.map((p) => p.value), 1);
  return (
    <div className="bg-card rounded-lg p-6 shadow-md">
      <h3 className="mb-4 text-lg font-semibold">{title}</h3>
      <div className="space-y-2">
        {series.map((item, idx) => (
          <div key={idx} className="flex items-center space-x-3">
            <span className="text-muted-foreground w-24 text-sm">
              {new Date(item.date).toLocaleDateString()}
            </span>
            <div className="bg-muted relative h-4 flex-1 rounded-full">
              <div
                className="h-4 rounded-full transition-all duration-300"
                style={{ width: `${(item.value / max) * 100}%`, backgroundColor: 'var(--chart-2)' }}
              />
            </div>
            <span className="w-16 text-sm font-medium">
              {Math.round(item.value).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
      <div className="text-muted-foreground mt-3 text-xs">{label}</div>
    </div>
  );
}
