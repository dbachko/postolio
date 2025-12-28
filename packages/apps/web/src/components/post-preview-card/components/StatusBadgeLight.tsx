import { PostStatusTimeBadge } from '@/components/PostStatusTimeBadge';
import type { PostStatus } from '../types';

interface StatusBadgeLightProps {
  status: PostStatus;
  displayTime: string;
}

/**
 * Lightweight status badge without tooltips or drag handles.
 * Used for initial render before user interaction.
 */
export function StatusBadgeLight({ status, displayTime }: StatusBadgeLightProps) {
  return (
    <PostStatusTimeBadge status={status} variant="inline" className="relative">
      {displayTime ? (
        <span className="underline-offset-2">{displayTime}</span>
      ) : (
        <span className="italic">No time</span>
      )}
    </PostStatusTimeBadge>
  );
}
