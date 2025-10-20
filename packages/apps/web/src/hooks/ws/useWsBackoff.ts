import { useCallback } from 'react';

export function useWsBackoff() {
  return useCallback((attemptNumber: number) => {
    const baseDelay = Math.min(Math.pow(2, attemptNumber) * 1000, 30000);
    const jitter = Math.random() * 0.1 * baseDelay;
    return Math.floor(baseDelay + jitter);
  }, []);
}
