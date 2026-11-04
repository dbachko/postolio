import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';

const OFFLINE_QUEUE_STORAGE_KEY = 'offlineQueue';

export interface QueuedAction {
  id: string;
  type: 'schedule' | 'reschedule' | 'cancel';
  payload: Record<string, unknown>;
  timestamp: number;
  retries: number;
  maxRetries?: number;
}

interface UseOfflineQueueOptions {
  maxRetries?: number;
  retryDelay?: number;
  onProcess?: (action: QueuedAction) => Promise<boolean>;
  onError?: (action: QueuedAction, error: Error) => void;
}

function readOfflineQueueFromStorage() {
  const savedQueue = localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
  if (!savedQueue) {
    return [] as QueuedAction[];
  }

  try {
    const parsed = JSON.parse(savedQueue);
    if (!Array.isArray(parsed)) {
      return [] as QueuedAction[];
    }

    return parsed.filter(
      (action) => action && typeof action === 'object' && action.id && action.type
    ) as QueuedAction[];
  } catch (error) {
    console.error('Failed to load offline queue:', error);
    localStorage.removeItem(OFFLINE_QUEUE_STORAGE_KEY);
    return [] as QueuedAction[];
  }
}

function persistOfflineQueue(queue: QueuedAction[]) {
  try {
    if (typeof Storage === 'undefined') {
      return;
    }
    localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('Failed to save offline queue:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      console.warn('LocalStorage quota exceeded, clearing old queue data');
      try {
        localStorage.removeItem(OFFLINE_QUEUE_STORAGE_KEY);
      } catch (clearError) {
        console.error(
          'Failed to clear corrupted queue:',
          clearError instanceof Error ? clearError.message : clearError
        );
      }
    }
  }
}

function createQueuedAction(
  type: QueuedAction['type'],
  payload: Record<string, unknown>,
  actionMaxRetries?: number
): QueuedAction {
  return {
    id:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    payload,
    timestamp: Date.now(),
    retries: 0,
    maxRetries: actionMaxRetries,
  };
}

function getActionMaxRetries(action: QueuedAction, fallback: number) {
  return action.maxRetries ?? fallback;
}

function useOfflineQueuePersistence({
  queueRef,
  retryTimeoutRef,
}: {
  queueRef: MutableRefObject<QueuedAction[]>;
  retryTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | undefined>;
}) {
  const clearRetryTimeout = useCallback(() => {
    const retryTimeout = retryTimeoutRef.current;
    if (retryTimeout) {
      clearTimeout(retryTimeout);
    }
  }, [retryTimeoutRef]);

  const saveQueue = useCallback(() => {
    persistOfflineQueue(queueRef.current);
  }, [queueRef]);

  useEffect(() => {
    queueRef.current = readOfflineQueueFromStorage();
  }, [queueRef]);

  useEffect(() => {
    return () => {
      clearRetryTimeout();
      if (queueRef.current.length > 0) {
        persistOfflineQueue(queueRef.current);
      }
    };
  }, [clearRetryTimeout, queueRef]);

  return { saveQueue };
}

function useProcessAction({
  onProcess,
  onError,
  maxRetries,
  dequeue,
  saveQueue,
}: {
  onProcess?: (action: QueuedAction) => Promise<boolean>;
  onError?: (action: QueuedAction, error: Error) => void;
  maxRetries: number;
  dequeue: (actionId: string) => void;
  saveQueue: () => void;
}) {
  return useCallback(
    async (action: QueuedAction) => {
      if (!onProcess) {
        console.warn('No onProcess handler provided for offline queue');
        return false;
      }

      const actionMaxRetries = getActionMaxRetries(action, maxRetries);

      try {
        const success = await onProcess(action);
        if (success) {
          dequeue(action.id);
          return true;
        }
      } catch (error) {
        action.retries++;
        if (action.retries >= actionMaxRetries) {
          onError?.(action, error as Error);
          dequeue(action.id);
          return false;
        }
        saveQueue();
        return false;
      }

      action.retries++;
      if (action.retries >= actionMaxRetries) {
        onError?.(action, new Error('Max retries exceeded'));
        dequeue(action.id);
        return false;
      }
      saveQueue();
      return false;
    },
    [dequeue, maxRetries, onError, onProcess, saveQueue]
  );
}

function useProcessQueue({
  queueRef,
  processingRef,
  retryTimeoutRef,
  processAction,
  maxRetries,
  retryDelay,
}: {
  queueRef: MutableRefObject<QueuedAction[]>;
  processingRef: MutableRefObject<boolean>;
  retryTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | undefined>;
  processAction: (action: QueuedAction) => Promise<boolean>;
  maxRetries: number;
  retryDelay: number;
}) {
  return useCallback(
    async function processQueue() {
      if (processingRef.current || queueRef.current.length === 0) {
        return;
      }

      processingRef.current = true;

      try {
        for (const action of [...queueRef.current]) {
          const success = await processAction(action);
          const actionMaxRetries = getActionMaxRetries(action, maxRetries);
          if (success || action.retries >= actionMaxRetries) {
            continue;
          }

          const baseDelay = retryDelay * Math.pow(2, action.retries - 1);
          const jitter = Math.random() * 0.3 * baseDelay;
          const delay = Math.min(baseDelay + jitter, 30000);
          retryTimeoutRef.current = setTimeout(() => {
            void processQueue();
          }, delay);
          break;
        }
      } catch (error) {
        console.error('Error during queue processing:', error);
      } finally {
        processingRef.current = false;
      }
    },
    [maxRetries, processAction, processingRef, queueRef, retryDelay, retryTimeoutRef]
  );
}

export function useOfflineQueue({
  maxRetries = 3,
  retryDelay = 1000,
  onProcess,
  onError,
}: UseOfflineQueueOptions = {}) {
  const queueRef = useRef<QueuedAction[]>([]);
  const processingRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { saveQueue } = useOfflineQueuePersistence({ queueRef, retryTimeoutRef });

  const dequeue = useCallback(
    (actionId: string) => {
      queueRef.current = queueRef.current.filter((action) => action.id !== actionId);
      saveQueue();
    },
    [saveQueue]
  );

  const enqueue = useCallback(
    (type: QueuedAction['type'], payload: Record<string, unknown>, actionMaxRetries?: number) => {
      const action = createQueuedAction(type, payload, actionMaxRetries);
      queueRef.current.push(action);
      saveQueue();
      return action.id;
    },
    [saveQueue]
  );

  const processAction = useProcessAction({ onProcess, onError, maxRetries, dequeue, saveQueue });
  const processQueue = useProcessQueue({
    queueRef,
    processingRef,
    retryTimeoutRef,
    processAction,
    maxRetries,
    retryDelay,
  });

  const clearQueue = useCallback(() => {
    queueRef.current = [];
    saveQueue();
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
  }, [saveQueue]);

  const getQueueSize = useCallback(() => queueRef.current.length, []);
  const getQueue = useCallback(() => [...queueRef.current], []);

  return useMemo(
    () => ({
      enqueue,
      dequeue,
      processQueue,
      clearQueue,
      getQueueSize,
      getQueue,
      isProcessing: () => processingRef.current,
      hasRetryScheduled: () => Boolean(retryTimeoutRef.current),
    }),
    [clearQueue, dequeue, enqueue, getQueue, getQueueSize, processQueue]
  );
}
