import { useMemo } from 'react';
import { ExternalLink, Instagram } from 'lucide-react';
import { Button } from '@/components/ui/button';

type PublicationLink = { key: string; platform: string; permalink: string };

function platformLabel(platform: string): string {
  const normalized = String(platform || '').toLowerCase();
  const labels: Record<string, string> = {
    instagram: 'Instagram',
    tiktok: 'TikTok',
    linkedin: 'LinkedIn',
    youtube: 'YouTube',
    facebook: 'Facebook',
    threads: 'Threads',
    x: 'X',
  };
  if (labels[normalized]) {
    return labels[normalized];
  }
  return platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Link';
}

function comparePublicationPlatform(a: PublicationLink, b: PublicationLink): number {
  if (a.platform === 'instagram') {
    return -1;
  }
  if (b.platform === 'instagram') {
    return 1;
  }
  return 0;
}

export function usePublicationButtons(
  publications: any[],
  postStatus?: string,
  instagramPermalink?: string | null
) {
  return useMemo(() => {
    const links: PublicationLink[] = publications
      .filter((publication) => Boolean(publication?.permalink))
      .map((publication: any) => ({
        key: String(
          publication.id || `${publication.platform || 'platform'}:${publication.permalink}`
        ),
        platform: String(publication.platform || ''),
        permalink: String(publication.permalink || ''),
      }));

    if (postStatus === 'published' && instagramPermalink) {
      links.push({
        key: 'post:instagramPermalink',
        platform: 'instagram',
        permalink: String(instagramPermalink),
      });
    }

    const seen = new Set<string>();
    const deduped = links
      .filter((link) => {
        const permalink = String(link.permalink || '').trim();
        if (!permalink || seen.has(permalink)) {
          return false;
        }
        seen.add(permalink);
        return true;
      })
      .sort(comparePublicationPlatform);

    return deduped.map((link) => (
      <Button
        key={link.key}
        variant="outline"
        size="sm"
        onClick={() => window.open(link.permalink, '_blank', 'noopener,noreferrer')}
        className="w-full justify-start gap-2"
      >
        {link.platform === 'instagram' ? (
          <Instagram className="h-4 w-4" />
        ) : (
          <ExternalLink className="h-4 w-4" />
        )}
        <span className="truncate">View on {platformLabel(link.platform)}</span>
      </Button>
    ));
  }, [publications, postStatus, instagramPermalink]);
}
