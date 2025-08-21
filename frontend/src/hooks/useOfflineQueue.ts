import { useRef, useCallback, useEffect } from 'react'

export interface QueuedAction {
  id: string
  type: 'schedule' | 'reschedule' | 'cancel'
  payload: any
  timestamp: number
  retries: number
}

interface UseOfflineQueueOptions {
  maxRetries?: number
  retryDelay?: number
  onProcess?: (action: QueuedAction) => Promise<boolean>
  onError?: (action: QueuedAction, error: Error) => void
}

export function useOfflineQueue({
  maxRetries = 3,
  retryDelay = 1000,
  onProcess,
  onError
}: UseOfflineQueueOptions = {}) {
  const queueRef = useRef<QueuedAction[]>([])
  const processingRef = useRef(false)
  const retryTimeoutRef = useRef<NodeJS.Timeout>()

  // Load queue from localStorage on mount
  useEffect(() => {
    const savedQueue = localStorage.getItem('offlineQueue')
    if (savedQueue) {
      try {
        queueRef.current = JSON.parse(savedQueue)
      } catch (error) {
        console.error('Failed to load offline queue:', error)
      }
    }
  }, [])

  // Save queue to localStorage
  const saveQueue = useCallback(() => {
    try {
      localStorage.setItem('offlineQueue', JSON.stringify(queueRef.current))
    } catch (error) {
      console.error('Failed to save offline queue:', error)
    }
  }, [])

  // Add action to queue
  const enqueue = useCallback((type: QueuedAction['type'], payload: any) => {
    const action: QueuedAction = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      payload,
      timestamp: Date.now(),
      retries: 0
    }
    
    queueRef.current.push(action)
    saveQueue()
    
    console.log('Action queued for offline processing:', action)
    
    return action.id
  }, [saveQueue])

  // Remove action from queue
  const dequeue = useCallback((actionId: string) => {
    queueRef.current = queueRef.current.filter(a => a.id !== actionId)
    saveQueue()
  }, [saveQueue])

  // Process a single action
  const processAction = useCallback(async (action: QueuedAction): Promise<boolean> => {
    if (!onProcess) {
      console.warn('No onProcess handler provided for offline queue')
      return false
    }

    try {
      const success = await onProcess(action)
      
      if (success) {
        dequeue(action.id)
        return true
      }
      
      // If not successful but no error thrown, retry
      action.retries++
      
      if (action.retries >= maxRetries) {
        console.error(`Max retries reached for action ${action.id}`)
        onError?.(action, new Error('Max retries exceeded'))
        dequeue(action.id)
        return false
      }
      
      saveQueue()
      return false
    } catch (error) {
      console.error(`Error processing action ${action.id}:`, error)
      
      action.retries++
      
      if (action.retries >= maxRetries) {
        onError?.(action, error as Error)
        dequeue(action.id)
        return false
      }
      
      saveQueue()
      return false
    }
  }, [onProcess, onError, dequeue, saveQueue, maxRetries])

  // Process all queued actions
  const processQueue = useCallback(async () => {
    if (processingRef.current || queueRef.current.length === 0) {
      return
    }

    processingRef.current = true
    console.log(`Processing ${queueRef.current.length} queued actions`)

    try {
      // Process actions in order
      for (const action of [...queueRef.current]) {
        const success = await processAction(action)
        
        if (!success && action.retries < maxRetries) {
          // Schedule retry with exponential backoff + jitter
          const baseDelay = retryDelay * Math.pow(2, action.retries - 1)
          const jitter = Math.random() * 0.3 * baseDelay // Add 30% jitter
          const delay = Math.min(baseDelay + jitter, 30000) // Cap at 30 seconds
          
          console.log(`Retrying action ${action.id} in ${Math.round(delay)}ms (attempt ${action.retries + 1}/${maxRetries})`)
          
          retryTimeoutRef.current = setTimeout(() => {
            processQueue()
          }, delay)
          
          break // Stop processing and wait for retry
        }
      }
    } catch (error) {
      console.error('Error during queue processing:', error)
    } finally {
      processingRef.current = false
    }
  }, [processAction, maxRetries, retryDelay])

  // Clear the queue
  const clearQueue = useCallback(() => {
    queueRef.current = []
    saveQueue()
    
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
    }
  }, [saveQueue])

  // Get queue size
  const getQueueSize = useCallback(() => {
    return queueRef.current.length
  }, [])

  // Get all queued actions
  const getQueue = useCallback(() => {
    return [...queueRef.current]
  }, [])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
    }
  }, [])

  return {
    enqueue,
    dequeue,
    processQueue,
    clearQueue,
    getQueueSize,
    getQueue
  }
}