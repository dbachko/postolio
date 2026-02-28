import type { MutableRefObject } from 'react';

import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import type { PostDetailData } from '@/hooks/usePostDetail';

export type PostEditorFormStateParams = {
  id?: string;
  post: PostDetailData | undefined;
  brandTimezone: string;
  selectedBrandId: string | null;
  isMultiDestinationGroup: boolean;
  contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
  postAssetIds: string[];
  mediaAssetsById: Record<string, any> | undefined;
  selectedTargetSocialAccountId: string | null;
  platformPickerOptions: SocialAccountsPickerOption[];
  multiDestinationEnabled: boolean;
  setSelectedPlatformAccountIds: (ids: string[]) => void;
  platformsInitializedRef: MutableRefObject<boolean>;
  locationSearch: string;
};
