// The development helper must never apply migrations or resets to a remote database.
for (const name of ['DATABASE_URL', 'ASSETS_DATABASE_URL']) {
  if (!process.env[name]) continue;
  const url = new URL(process.env[name]);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.searchParams.has('host') ||
    url.searchParams.has('hostaddr')
  ) {
    throw new Error(`${name} must target a local PostgreSQL database for dev:stack`);
  }
}
