import { useEffect, type RefObject } from 'react';

interface UseInfiniteScrollSentinelArgs {
  loadMoreRef: RefObject<HTMLDivElement | null>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
  dependency: number;
}

export function useInfiniteScrollSentinel({
  loadMoreRef,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  dependency,
}: UseInfiniteScrollSentinelArgs) {
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: '320px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [dependency, fetchNextPage, hasNextPage, isFetchingNextPage, loadMoreRef]);
}
