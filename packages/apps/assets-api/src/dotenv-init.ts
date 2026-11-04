import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

// pnpm runs this package with cwd `packages/apps/assets-api`. A bare
// dotenv.config() looks there and misses the monorepo root `.env` that
// `pnpm dev:stack` and the main API both use.
dotenv.config({ path: path.resolve(dirname, '../../../../.env'), quiet: true });
dotenv.config({ quiet: true });
