import type { NavigateFunction } from 'react-router-dom';
import { toast } from 'sonner';

import { TIMEOUTS } from '@/constants/timeouts';
import { getUserTimezone } from '@/lib/timezone';

export interface RegisterFormData {
  email: string;
  password: string;
  name: string;
}

interface CreateRegisterSubmitHandlerParams {
  registerUser: (email: string, password: string, name: string, timezone: string) => Promise<void>;
  navigate: NavigateFunction;
  setError: (value: string) => void;
  setIsLoading: (value: boolean) => void;
}

export function createRegisterSubmitHandler(params: CreateRegisterSubmitHandlerParams) {
  return async (data: RegisterFormData) => {
    params.setIsLoading(true);
    params.setError('');

    try {
      const timezone = getUserTimezone();
      await params.registerUser(data.email, data.password, data.name, timezone);
      toast.success('Account created successfully!', {
        description: 'Welcome to Postolio! Redirecting to dashboard...',
        duration: TIMEOUTS.TOAST_DURATION,
      });
      setTimeout(() => params.navigate('/dashboard'), TIMEOUTS.SUCCESS_REDIRECT);
    } catch (error: unknown) {
      const apiError = error as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      const message =
        apiError?.response?.data?.message ||
        apiError?.message ||
        'Registration failed. Please try again.';

      params.setError(message);
      toast.error('Registration failed', {
        description: message,
        duration: TIMEOUTS.TOAST_DURATION,
      });
    } finally {
      params.setIsLoading(false);
    }
  };
}
