export function getEnvironmentName(): string {
  return (process.env.ENVIRONMENT || process.env.NODE_ENV || '').toLowerCase();
}

export function isProductionEnv(): boolean {
  const env = getEnvironmentName();
  const extra = (process.env.PRODUCTION_ENVIRONMENTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return env === 'prod' || env === 'production' || extra.includes(env);
}

export function isDevelopmentEnv(): boolean {
  const env = getEnvironmentName();
  return env === 'dev' || env === 'development';
}
