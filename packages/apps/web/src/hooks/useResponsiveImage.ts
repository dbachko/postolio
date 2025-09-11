import { useState, useEffect } from 'react';

// Hook for responsive image loading
export const useResponsiveImage = (
  baseUrl: string,
  sizes: { sm?: string; md?: string; lg?: string; xl?: string }
) => {
  const [currentSize, setCurrentSize] = useState<string>('md');

  useEffect(() => {
    const updateSize = () => {
      const width = window.innerWidth;
      if (width < 640) setCurrentSize('sm');
      else if (width < 768) setCurrentSize('md');
      else if (width < 1024) setCurrentSize('lg');
      else setCurrentSize('xl');
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  return sizes[currentSize as keyof typeof sizes] || baseUrl;
};
