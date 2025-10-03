import { memo } from 'react';

interface SkeletonProps {
  className?: string;
}

// Simple Tailwind-based skeleton block with pulse animation
const Skeleton = memo(({ className = '' }: SkeletonProps) => {
  return <div className={`animate-pulse rounded-md bg-gray-200 ${className}`} />;
});

Skeleton.displayName = 'Skeleton';

export { Skeleton };

