/**
 * Image utility functions
 */

// Preload component for critical images
export const preloadImage = (url: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`Failed to preload image: ${url}`))
    img.src = url
  })
}

// Check browser support for modern image formats
export const supportsWebP = (): boolean => {
  if (typeof window === 'undefined') return false
  
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  return canvas.toDataURL('image/webp').indexOf('image/webp') === 5
}

// Future enhancement: AVIF support detection
export const supportsAVIF = (): boolean => {
  if (typeof window === 'undefined') return false
  
  // Simple AVIF support detection
  const avif = new Image()
  return 'decode' in avif && avif.src.indexOf('data:image/avif') === 0
}