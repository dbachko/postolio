import { Monitor, Smartphone, Tablet, Globe } from 'lucide-react';

interface DeviceIconProps {
  userAgent?: string | null;
  deviceName?: string | null;
  className?: string;
}

export function DeviceIcon({ userAgent, deviceName, className = 'h-5 w-5' }: DeviceIconProps) {
  const getDeviceType = (): 'desktop' | 'mobile' | 'tablet' | 'unknown' => {
    const ua = (userAgent || deviceName || '').toLowerCase();

    if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('android')) {
      return 'mobile';
    }

    if (ua.includes('ipad') || ua.includes('tablet')) {
      return 'tablet';
    }

    if (
      ua.includes('mac') ||
      ua.includes('windows') ||
      ua.includes('linux') ||
      ua.includes('chrome') ||
      ua.includes('firefox') ||
      ua.includes('safari')
    ) {
      return 'desktop';
    }

    return 'unknown';
  };

  const deviceType = getDeviceType();

  switch (deviceType) {
    case 'desktop':
      return <Monitor className={className} />;
    case 'mobile':
      return <Smartphone className={className} />;
    case 'tablet':
      return <Tablet className={className} />;
    default:
      return <Globe className={className} />;
  }
}
