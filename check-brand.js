import 'dotenv/config';
import { getDatabaseClient, disconnectDatabase } from './packages/apps/api/src/config/database.js';

const prisma = getDatabaseClient();
const brand = await prisma.brand.findFirst({
  where: { name: 'Test Brand' },
  select: {
    id: true,
    name: true,
    instagramAccountId: true,
    instagramPageId: true,
    instagramProfileData: true,
  },
});

console.log('Brand data:');
console.log(JSON.stringify(brand, null, 2));
await disconnectDatabase();
