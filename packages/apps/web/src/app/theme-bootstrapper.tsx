import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';

import { useAuthStore } from '@/stores/authStore';

export function ThemeBootstrapper() {
  const { user } = useAuthStore();
  const { setTheme } = useTheme();
  const didInit = useRef(false);
  useEffect(() => {
    // Only set theme from user once when the user data becomes available
    if (!user || didInit.current) return;
    didInit.current = true;
    if (user.theme) setTheme(user.theme);
  }, [user, setTheme]);
  return null;
}
