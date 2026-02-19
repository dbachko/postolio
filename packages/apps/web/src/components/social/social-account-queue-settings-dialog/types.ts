export type SocialAccountOption = {
  id: string;
  platform: string;
  username?: string | null;
  displayName?: string | null;
  externalAccountId?: string | null;
  profilePictureUrl?: string | null;
};

export type SocialAccountQueueSettingsPanelProps = {
  account: SocialAccountOption | null;
  allAccounts: SocialAccountOption[];
  onClose?: () => void;
  hideHeader?: boolean;
  selectedQueueId?: string | null;
  onSelectedQueueIdChange?: (queueId: string | null) => void;
};

export type SocialAccountQueueSettingsDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  account: SocialAccountOption | null;
  allAccounts: SocialAccountOption[];
};
