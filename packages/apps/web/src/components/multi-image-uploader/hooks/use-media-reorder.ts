import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { MediaItem } from '../types';

export function useMediaReorder(params: {
  setMediaItems: Dispatch<SetStateAction<MediaItem[]>>;
  onCommit: (items: MediaItem[]) => void;
}) {
  const { setMediaItems, onCommit } = params;

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const draggedIndexRef = useRef<number | null>(null);

  const handleDragStart = useCallback((e: DragEvent<HTMLElement>, index: number) => {
    setDraggedIndex(index);
    draggedIndexRef.current = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  }, []);

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLElement>, index: number) => {
      e.preventDefault();
      const currentIndex = draggedIndexRef.current;
      if (currentIndex === null || currentIndex === index) {
        return;
      }

      setMediaItems((prev) => {
        const updated = [...prev];
        const draggedItem = updated[currentIndex];
        if (!draggedItem) {
          return prev;
        }

        updated.splice(currentIndex, 1);
        updated.splice(index, 0, draggedItem);
        return updated;
      });

      draggedIndexRef.current = index;
      setDraggedIndex(index);
    },
    [setMediaItems]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    draggedIndexRef.current = null;
    setMediaItems((prev) => {
      onCommit(prev);
      return prev;
    });
  }, [onCommit, setMediaItems]);

  return { draggedIndex, handleDragStart, handleDragOver, handleDragEnd };
}
