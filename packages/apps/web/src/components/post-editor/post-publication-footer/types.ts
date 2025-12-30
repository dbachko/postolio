export type PublicationLink = {
  platform: string;
  url: string;
};

export type PublicationPreviewMedia = {
  url: string;
  type: 'image' | 'video';
  thumbnailUrl?: string | null;
};
