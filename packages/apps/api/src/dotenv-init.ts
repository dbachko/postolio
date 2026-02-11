import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer the monorepo root `.env` (most docs/scripts assume env lives there).
// pnpm sets the package cwd to `packages/apps/api`, so `dotenv.config()` alone
// would otherwise look for `packages/apps/api/.env`.
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

// Set DATABASE_URL from individual database components if not already set
if (!process.env.DATABASE_URL && process.env.DB_USERNAME) {
  const { DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME } = process.env;

  if (DB_USERNAME && DB_PASSWORD && DB_HOST && DB_PORT && DB_NAME) {
    // URL encode the username and password to handle special characters
    const encodedUsername = encodeURIComponent(DB_USERNAME);
    const encodedPassword = encodeURIComponent(DB_PASSWORD);

    process.env.DATABASE_URL = `postgresql://${encodedUsername}:${encodedPassword}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
  }
}
