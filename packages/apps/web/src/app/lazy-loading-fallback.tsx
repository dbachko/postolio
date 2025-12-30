type LazyLoadingFallbackProps = {
  minHeight?: string;
};

export function LazyLoadingFallback({ minHeight = '200px' }: LazyLoadingFallbackProps) {
  return (
    <div className="flex items-center justify-center" style={{ minHeight }}>
      <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2"></div>
    </div>
  );
}
