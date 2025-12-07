export function isDemoBrand(preferences: unknown): boolean {
  if (!preferences || typeof preferences !== 'object') return false;
  const prefs = preferences as Record<string, unknown>;
  if (typeof prefs.isDemo === 'boolean') return prefs.isDemo;
  if (prefs.onboarding && typeof prefs.onboarding === 'object') {
    const onboarding = prefs.onboarding as Record<string, unknown>;
    if (typeof onboarding.isDemo === 'boolean') return onboarding.isDemo;
  }
  return false;
}
