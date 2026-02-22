import type { PostPreviewItem, PreviewMedia } from '../types';

export const stripLeadingAt = (value: string) => (value.startsWith('@') ? value.slice(1) : value);

export const getAccountDisplayName = (account: PostPreviewItem['account']) => {
  const label = (account.label || '').trim();
  if (label) {
    return label;
  }
  const avatarName = (account.avatarName || '').trim();
  if (avatarName) {
    return avatarName;
  }
  return 'Account';
};

export const getPreviewImageUrl = (primaryMedia: PreviewMedia | null) => {
  if (!primaryMedia) {
    return '';
  }
  if (primaryMedia.type === 'video') {
    return primaryMedia.thumbnailUrl || primaryMedia.url || '';
  }
  return primaryMedia.url || '';
};
