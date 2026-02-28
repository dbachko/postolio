import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';
import type { PostDetailData } from '@/hooks/usePostDetail';
import type { Platform } from '@/lib/platform-config';

import type { PostEditorLayout } from '../types';

export type PostEditorDerivedParams = {
  id?: string;
  layout: PostEditorLayout;
  isMultiDestinationGroup: boolean;
  groupDestinations: Array<{
    contentId: string;
    platform: Platform;
    label: string;
    disconnected: boolean;
  }>;
  groupPlatforms: Platform[];
  contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
  post: PostDetailData | undefined;
  brandTimezone: string;
  atCapacity: boolean;
  limitMessage: string;
  formData: PostEditorFormState;
  firstCommentOpen: boolean;
  selectedPlatformAccountIds: string[];
  platformPickerOptions: SocialAccountsPickerOption[];
  selectedPlatforms: Platform[];
  schedulingSupported: boolean;
  publishingSupported: boolean;
  queueActionAccountIds: string[];
  queueSlotsBySocialAccountId: Record<string, boolean | null>;
  queueSlotsLoadingBySocialAccountId: Record<string, boolean>;
  queueSlotsErrorBySocialAccountId: Record<string, boolean>;
  isCreatingPost: boolean;
};
