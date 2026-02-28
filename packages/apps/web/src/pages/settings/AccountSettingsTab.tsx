import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { AccountDeletionCard } from './account-settings/account-deletion-card';
import { useAccountDeletion } from './account-settings/use-account-deletion';

export default function AccountSettingsTab() {
  const deletion = useAccountDeletion();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account Settings</CardTitle>
        <CardDescription>Manage your account information and preferences</CardDescription>
      </CardHeader>
      <CardContent>
        <div id="delete-account" className="mt-6 border-t pt-6">
          <AccountDeletionCard
            deletionReasons={deletion.deletionReasons}
            isLoadingDeletionReasons={deletion.isLoadingDeletionReasons}
            selectedDeletionReason={deletion.selectedDeletionReason}
            deletionFeedback={deletion.deletionFeedback}
            isDeletingAccount={deletion.isDeletingAccount}
            deletionRecoveryDeadline={deletion.deletionRecoveryDeadline}
            onSelectedDeletionReasonChange={deletion.setSelectedDeletionReason}
            onDeletionFeedbackChange={deletion.setDeletionFeedback}
            onDeleteAccount={deletion.handleDeleteAccount}
          />
        </div>
      </CardContent>
    </Card>
  );
}
