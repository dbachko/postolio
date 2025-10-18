export const DEFAULT_CAMPAIGN_NAME = 'Default Campaign';

// System-managed default campaigns are indefinite and not user-editable.
// We mark them as active for grouping and visibility.
export const DEFAULT_CAMPAIGN_STATUS = 'active' as const;
