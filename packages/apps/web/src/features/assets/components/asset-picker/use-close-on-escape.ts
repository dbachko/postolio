import { useEffect } from 'react';

export function useCloseOnEscape(onClose: () => void) {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose]);
}
