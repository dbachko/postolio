import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { NavigateFunction } from 'react-router-dom';

import { requestResetLink, resetPassword, validateResetToken } from './password-reset-api';
import {
  EMPTY_PASSWORD_STRENGTH,
  hasStrongPassword,
  type PasswordStrength,
} from './password-reset-types';

function calculatePasswordStrength(password: string): PasswordStrength {
  return {
    length: password.length >= 15,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
  };
}

function createRequestResetHandler(params: {
  email: string;
  setIsRequesting: (value: boolean) => void;
  setRequestError: (value: string) => void;
  setRequestSuccess: (value: boolean) => void;
}) {
  return async (event: FormEvent) => {
    event.preventDefault();
    params.setIsRequesting(true);
    params.setRequestError('');

    try {
      await requestResetLink(params.email);
      params.setRequestSuccess(true);
    } catch (error) {
      params.setRequestError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      params.setIsRequesting(false);
    }
  };
}

function createResetPasswordHandler(params: {
  token: string | null;
  password: string;
  confirmPassword: string;
  passwordStrength: PasswordStrength;
  setIsResetting: (value: boolean) => void;
  setResetError: (value: string) => void;
  navigate: NavigateFunction;
}) {
  return async (event: FormEvent) => {
    event.preventDefault();

    if (params.password !== params.confirmPassword) {
      params.setResetError("Passwords don't match");
      return;
    }

    if (!hasStrongPassword(params.passwordStrength)) {
      params.setResetError('Password does not meet all requirements');
      return;
    }

    if (!params.token) {
      params.setResetError('Missing reset token');
      return;
    }

    params.setIsResetting(true);
    params.setResetError('');

    try {
      await resetPassword({
        token: params.token,
        password: params.password,
        confirmPassword: params.confirmPassword,
      });
      params.navigate('/login', {
        state: {
          message: 'Password reset successfully! Please log in with your new password.',
        },
      });
    } catch (error) {
      params.setResetError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      params.setIsResetting(false);
    }
  };
}

export function usePasswordResetState(token: string | null, navigate: NavigateFunction) {
  const [email, setEmail] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [requestSuccess, setRequestSuccess] = useState(false);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [tokenEmail, setTokenEmail] = useState('');
  const [passwordStrength, setPasswordStrength] =
    useState<PasswordStrength>(EMPTY_PASSWORD_STRENGTH);

  useEffect(() => {
    if (!token) {
      return;
    }

    void (async () => {
      try {
        const validation = await validateResetToken(token);
        setTokenValid(validation.valid);
        if (validation.email) {
          setTokenEmail(validation.email);
        }
      } catch {
        setTokenValid(false);
      }
    })();
  }, [token]);

  useEffect(() => {
    setPasswordStrength(calculatePasswordStrength(password));
  }, [password]);

  const handleRequestReset = useMemo(
    () =>
      createRequestResetHandler({
        email,
        setIsRequesting,
        setRequestError,
        setRequestSuccess,
      }),
    [email]
  );

  const handleResetPassword = useMemo(
    () =>
      createResetPasswordHandler({
        token,
        password,
        confirmPassword,
        passwordStrength,
        setIsResetting,
        setResetError,
        navigate,
      }),
    [confirmPassword, navigate, password, passwordStrength, token]
  );

  return {
    email,
    setEmail,
    isRequesting,
    requestError,
    requestSuccess,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    isResetting,
    resetError,
    tokenValid,
    tokenEmail,
    passwordStrength,
    canSubmitReset: hasStrongPassword(passwordStrength),
    handleRequestReset,
    handleResetPassword,
  };
}
