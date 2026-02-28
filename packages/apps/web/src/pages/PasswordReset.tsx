import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  PasswordResetInvalidTokenView,
  PasswordResetRequestForm,
  PasswordResetTokenForm,
} from './password-reset/password-reset-content';
import { usePasswordResetState } from './password-reset/use-password-reset-state';

function PasswordResetLayout(props: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
      {props.children}
    </div>
  );
}

export function PasswordReset() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const state = usePasswordResetState(token, navigate);

  if (token && state.tokenValid === false) {
    return (
      <PasswordResetLayout>
        <PasswordResetInvalidTokenView />
      </PasswordResetLayout>
    );
  }

  return (
    <PasswordResetLayout>
      {token ? (
        <PasswordResetTokenForm
          tokenEmail={state.tokenEmail}
          password={state.password}
          confirmPassword={state.confirmPassword}
          isResetting={state.isResetting}
          resetError={state.resetError}
          canSubmitReset={state.canSubmitReset}
          passwordStrength={state.passwordStrength}
          onPasswordChange={state.setPassword}
          onConfirmPasswordChange={state.setConfirmPassword}
          onSubmit={state.handleResetPassword}
        />
      ) : (
        <PasswordResetRequestForm
          requestSuccess={state.requestSuccess}
          requestError={state.requestError}
          email={state.email}
          isRequesting={state.isRequesting}
          onEmailChange={state.setEmail}
          onSubmit={state.handleRequestReset}
        />
      )}
    </PasswordResetLayout>
  );
}
