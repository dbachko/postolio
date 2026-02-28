import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { httpDelete, httpGet } from '@/lib/api';

export interface DeletionReason {
  id: string;
  label: string;
}

export function useAccountDeletion() {
  const [deletionReasons, setDeletionReasons] = useState<DeletionReason[]>([]);
  const [isLoadingDeletionReasons, setIsLoadingDeletionReasons] = useState(false);
  const [selectedDeletionReason, setSelectedDeletionReason] = useState<string | null>(null);
  const [deletionFeedback, setDeletionFeedback] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deletionRecoveryDeadline, setDeletionRecoveryDeadline] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setIsLoadingDeletionReasons(true);
      try {
        const response = await httpGet('/api/legal/deletion-reasons');
        if (response?.reasons && Array.isArray(response.reasons)) {
          setDeletionReasons(response.reasons as DeletionReason[]);
        }
      } catch (error) {
        console.error('Failed to load deletion reasons', error);
      } finally {
        setIsLoadingDeletionReasons(false);
      }
    })();
  }, []);

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to delete your Postolio account? This will schedule your account for deletion and may remove associated brands, posts, and analytics after the recovery period.'
    );

    if (!confirmed) {
      return;
    }

    setIsDeletingAccount(true);
    setDeletionRecoveryDeadline(null);

    try {
      const payload: { reason?: string; feedback?: string } = {};
      if (selectedDeletionReason) {
        payload.reason = selectedDeletionReason;
      }
      if (deletionFeedback.trim()) {
        payload.feedback = deletionFeedback.trim();
      }

      const response = await httpDelete('/api/legal/account', {
        body: JSON.stringify(payload),
      });

      toast.success(
        response?.message ||
          'Your account has been scheduled for deletion. Check your email for details.'
      );

      if (response?.recoveryDeadline) {
        setDeletionRecoveryDeadline(response.recoveryDeadline as string);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to schedule account deletion.';
      toast.error(message);
      console.error('Account deletion error:', error);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return {
    deletionReasons,
    isLoadingDeletionReasons,
    selectedDeletionReason,
    setSelectedDeletionReason,
    deletionFeedback,
    setDeletionFeedback,
    isDeletingAccount,
    deletionRecoveryDeadline,
    handleDeleteAccount,
  };
}
