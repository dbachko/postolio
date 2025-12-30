import type { AssetReference } from '@/components/multi-image-uploader/types';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import type { PostDetailData } from '@/hooks/usePostDetail';
import type { Brand, Campaign } from '@/lib/api';
import type { InstagramContentType } from '@postolio/content-validation';

export interface PostEditorFormState {
  caption: string;
  carouselAssets: AssetReference[];
  contentType: InstagramContentType;
  scheduledAt: string;
  shareToFeed: boolean;
  firstComment: string;
}

export interface PostEditorMainBodyProps {
  mode: 'create' | 'edit';
  allowMixedMedia: boolean;
  disabled: boolean;
  isLoading: boolean;
  post?: PostDetailData;
  selectedBrand: Brand | null;
  formData: PostEditorFormState;
  setFormData: (updater: (prev: PostEditorFormState) => PostEditorFormState) => void;
  firstCommentOpen: boolean;
  setFirstCommentOpen: (open: boolean) => void;
  campaigns: Campaign[];
  isLoadingCampaigns: boolean;
  selectedCampaign: string | null;
  setSelectedCampaign: (campaignId: string | null) => void;
  selectedCampaignPaused: boolean;
  onOpenAssetPicker: () => void;
  platformOptions?: SocialAccountsPickerOption[];
  selectedPlatformAccountIds?: string[];
  onSelectedPlatformAccountIdsChange?: (value: string[]) => void;
  showDestinationsPicker?: boolean;
}
