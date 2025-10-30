// Centralized placeholder asset paths for the web app
// Static assets in `public/` are served from the root (`/`)

// Use gray placeholder with centered brand icon
export const POST_PLACEHOLDER_IMAGE = '/post-placeholder.svg';

export function getPostImageOrPlaceholder(url?: string | null): string {
  return url && url.trim().length > 0 ? url : POST_PLACEHOLDER_IMAGE;
}
