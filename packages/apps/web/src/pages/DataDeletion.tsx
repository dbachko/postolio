import { useAuthStore } from '@/stores/authStore';

import {
  DataDeletionInitialErrorView,
  DataDeletionLoadingView,
  DataDeletionMainView,
} from './data-deletion/data-deletion-view';
import { useDataDeletionPage } from './data-deletion/use-data-deletion-page';

export function DataDeletion() {
  const userEmail = useAuthStore((state) => state.user?.email);
  const state = useDataDeletionPage(userEmail);

  if (state.loading) {
    return <DataDeletionLoadingView />;
  }

  if (state.error && !state.content) {
    return <DataDeletionInitialErrorView error={state.error} />;
  }

  return (
    <DataDeletionMainView
      content={state.content}
      error={state.error}
      email={state.email}
      requestSent={state.requestSent}
      submitting={state.submitting}
      isSignedIn={Boolean(userEmail)}
      onEmailChange={state.setEmail}
      onSubmit={state.handleDeletionRequest}
    />
  );
}
