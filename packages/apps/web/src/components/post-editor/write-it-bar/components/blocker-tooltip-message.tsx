import { getPlatformConfig } from '@/lib/platform-config';
import { getPlatformIcon } from '@/lib/platform-icons';

import { parsePlatformPrefixedMessage } from '../utils';

export function BlockerTooltipMessage({ message }: { message: string }) {
  const parsed = parsePlatformPrefixedMessage(message);
  const icon = parsed.platform ? getPlatformIcon(parsed.platform, 'h-4 w-4') : null;
  const color = (() => {
    if (!parsed.platform) {
      return null;
    }
    try {
      return getPlatformConfig(parsed.platform).color;
    } catch {
      return null;
    }
  })();

  if (!icon) {
    return <p className="text-sm">{parsed.message}</p>;
  }

  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5" style={color ? { color } : undefined}>
        {icon}
      </span>
      <p className="text-sm">{parsed.message}</p>
    </div>
  );
}
