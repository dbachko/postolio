import { Badge } from '@/components/ui/badge';
import { ProfileAvatar } from '@/components/ui/profile-avatar';
import type { Platform } from '@/lib/platform-config';
import { formatSocialAccountHandle } from '@/lib/social-account-label';
import type { SocialProfile } from '../types';
import { getAccountTypeLabel } from '../utils';

interface ConnectedProfileCardProps {
  platform: Platform;
  profile: SocialProfile;
}

export function ConnectedProfileCard({ platform, profile }: ConnectedProfileCardProps) {
  return (
    <div className="bg-muted rounded-lg border p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <ProfileAvatar
            src={profile.profile_picture_url || null}
            name={profile.name || profile.username}
            alt={formatSocialAccountHandle(platform, profile.username) || profile.username}
            size="lg"
          />
          <div>
            <h3 className="font-medium">{profile.name || profile.username}</h3>
            <a
              href={`https://${platform}.com/${profile.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary text-sm hover:underline"
            >
              {formatSocialAccountHandle(platform, profile.username) || profile.username}
            </a>
            <div className="mt-1 flex items-center space-x-4">
              {profile.followers_count !== undefined && profile.followers_count !== null && (
                <span className="text-muted-foreground text-xs">
                  {profile.followers_count.toLocaleString()} followers
                </span>
              )}
              {profile.media_count !== undefined && profile.media_count !== null && (
                <span className="text-muted-foreground text-xs">
                  {profile.media_count === 0 ? 'No posts yet' : `${profile.media_count} posts`}
                </span>
              )}
            </div>
          </div>
        </div>
        {profile.account_type && (
          <Badge
            variant={profile.account_type === 'BUSINESS' ? 'default' : 'secondary'}
            className="ml-2"
          >
            {getAccountTypeLabel(profile.account_type)}
          </Badge>
        )}
      </div>
      {profile.biography && (
        <p className="text-muted-foreground mt-3 text-sm">{profile.biography}</p>
      )}
    </div>
  );
}
