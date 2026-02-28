import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';

import { SiteFooter } from '@/components/site-footer';
import { validationRules } from '@/utils/validation';
import { useAuthStore } from '@/stores/authStore';

import { getRegisterAuthFlags } from './register/register-auth-flags';
import { RegisterPageContent } from './register/register-page-content';
import { createRegisterSubmitHandler, type RegisterFormData } from './register/use-register-submit';

export function Register() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showMagicLink, setShowMagicLink] = useState(false);

  const { register: registerUser } = useAuthStore();
  const navigate = useNavigate();
  const flags = getRegisterAuthFlags();

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<RegisterFormData>({ mode: 'onChange', reValidateMode: 'onChange' });

  const onSubmit = createRegisterSubmitHandler({
    registerUser,
    navigate,
    setError,
    setIsLoading,
  });

  const password = watch('password', '');

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <RegisterPageContent
          flags={flags}
          error={error}
          isLoading={isLoading}
          showPassword={showPassword}
          showMagicLink={showMagicLink}
          password={password}
          register={register}
          errors={errors}
          nameRules={validationRules.name}
          emailRules={validationRules.email}
          passwordRules={validationRules.password}
          onTogglePassword={() => setShowPassword((prev) => !prev)}
          onSubmit={handleSubmit(onSubmit)}
          onShowMagicLinkChange={setShowMagicLink}
          onMagicLinkSuccess={() => navigate('/dashboard')}
        />
      </div>

      <SiteFooter />
    </div>
  );
}
