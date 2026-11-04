import { prisma } from '../config/database.js';

/** Only a user's own notifications and owned brands may be subscribed to. */
export async function authorizeRooms(userId: string, rooms: unknown[]): Promise<boolean> {
  if (!rooms.length || rooms.length > 50) {
    return false;
  }
  const brands = new Set<string>();
  for (const room of rooms) {
    if (typeof room !== 'string') {
      return false;
    }
    if (room === `user:${userId}`) {
      continue;
    }
    if (!/^brand:[a-zA-Z0-9_-]+$/.test(room)) {
      return false;
    }
    brands.add(room.slice(6));
  }
  if (!brands.size) {
    return true;
  }
  const owned = await prisma.brand.count({ where: { id: { in: [...brands] }, userId } });
  return owned === brands.size;
}
