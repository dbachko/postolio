export type RecentItem = {
  caption: string | null;
  hashtags: string[] | null;
  createdAt: Date;
};

export type BrandLocationContext = {
  postingTimezone?: string | null;
  countryCode?: string | null;
};
