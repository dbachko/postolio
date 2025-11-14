import { getEnabledPlatforms, type Platform } from '@/lib/platform-config';
import { SocialAccountConnect } from './SocialAccountConnect';
import type { Brand } from '@/lib/api';
import { ErrorBoundary } from '../ErrorBoundary';

interface SocialAccountListProps {
  brand: Brand;
  /** Optional callback when any platform connection changes */
  onConnectionChange?: (platform: Platform, connected: boolean) => void;
  /** Show only specific platforms (defaults to all enabled platforms) */
  platforms?: Platform[];
}

export function SocialAccountList({
  brand,
  onConnectionChange,
  platforms,
}: SocialAccountListProps) {
  // Get platforms to display - either specified list or all enabled
  const platformsToShow = platforms || getEnabledPlatforms().map((p) => p.id);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Connected Accounts</h2>
        <p className="text-muted-foreground">
          Connect your social media accounts to enable content publishing and analytics
        </p>
      </div>

      <div className="space-y-4">
        {platformsToShow.map((platform) => (
          <ErrorBoundary
            key={platform}
            fallback={
              <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-4">
                <p className="text-destructive text-sm">
                  Failed to load {platform} connection. Please refresh the page.
                </p>
              </div>
            }
          >
            <SocialAccountConnect
              platform={platform}
              brand={brand}
              onConnectionChange={(connected) => onConnectionChange?.(platform, connected)}
            />
          </ErrorBoundary>
        ))}
      </div>
    </div>
  );
}
