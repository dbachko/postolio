import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { SiteFooter } from '@/components/site-footer';
import { useAuthStore } from '@/stores/authStore';

import { getLoginAuthFlags } from './login/login-auth-flags';
import { LoginPageContent } from './login/login-page-content';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showMagicLink, setShowMagicLink] = useState(false);

  const { login } = useAuthStore();
  const navigate = useNavigate();
  const flags = getLoginAuthFlags();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await login(email, password, rememberMe);
      navigate('/dashboard');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message || 'Internal server error. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <div className="bg-background flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <LoginPageContent
          email={email}
          password={password}
          rememberMe={rememberMe}
          isLoading={isLoading}
          error={error}
          showMagicLink={showMagicLink}
          flags={flags}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onRememberMeChange={setRememberMe}
          onShowMagicLinkChange={setShowMagicLink}
          onSubmit={handleSubmit}
          onMagicLinkSuccess={() => navigate('/dashboard')}
        />
      </div>

      <SiteFooter />
    </div>
  );
}
