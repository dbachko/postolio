import { memo } from 'react';
import { cn } from '../../lib/utils';

interface ProgressProps {
  value: number;
  className?: string;
  indicatorClassName?: string;
}

const Progress = memo(({ value, className, indicatorClassName }: ProgressProps) => {
  const clampedValue = Math.min(100, Math.max(0, value));

  return (
    <div className={cn('relative h-2 w-full overflow-hidden rounded-full bg-gray-200', className)}>
      <div
        className={cn(
          'h-full w-full flex-1 bg-blue-600 transition-all duration-300 ease-out',
          indicatorClassName
        )}
        style={{
          transform: `translateX(-${100 - clampedValue}%)`,
        }}
      />
    </div>
  );
});

Progress.displayName = 'Progress';

export { Progress };
