import '../src/dotenv-init.js';
import { getDatabaseClient, disconnectDatabase } from '../src/config/database.js';

type Args = {
  email?: string;
  brand?: string;
};

function parseArgs(): Args {
  const out: Args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const token = process.argv[i];
    if (!token.startsWith('--')) continue;

    let key = token;
    let value: string | undefined;

    const eqIndex = token.indexOf('=');
    if (eqIndex >= 0) {
      key = token.slice(0, eqIndex);
      value = token.slice(eqIndex + 1);
    } else {
      value = process.argv[i + 1];
      i++;
    }

    if (!value) continue;

    switch (key) {
      case '--email':
        out.email = value;
        break;
      case '--brand':
        out.brand = value;
        break;
      default:
        break;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const email = args.email || process.env.DEV_SEED_EMAIL || 'dev@postolio.test';
  const brandName = args.brand || process.env.DEV_SEED_BRAND;

  const prisma = getDatabaseClient();

  try {
    const target = await prisma.brand.findFirst({
      where: {
        user: { email },
        ...(brandName ? { name: brandName } : {}),
      },
      select: { id: true },
    });

    const fallback =
      target ||
      (await prisma.brand.findFirst({
        where: { user: { email } },
        select: { id: true },
      }));

    if (!fallback) {
      console.error(
        `No brand found for email ${email}${brandName ? ` and brand ${brandName}` : ''}.`
      );
      process.exit(1);
    }

    process.stdout.write(`${fallback.id}\n`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error('Failed to determine brand id', err);
  process.exit(1);
});
