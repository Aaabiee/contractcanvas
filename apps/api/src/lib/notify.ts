import prisma from '../prisma.js';
import { pushToUser } from './sse-registry.js';
import type { Prisma } from '@prisma/client';

type NotificationCreateInput = Prisma.NotificationCreateInput;

export async function createNotification(
  data: NotificationCreateInput,
): Promise<ReturnType<typeof prisma.notification.create>> {
  const notification = await prisma.notification.create({ data });
  pushToUser(notification.userId, 'notification', notification);
  return notification;
}

export async function createNotifications(
  items: Prisma.NotificationCreateManyInput[],
): Promise<void> {
  if (items.length === 0) return;
  await prisma.notification.createMany({ data: items, skipDuplicates: true });
  for (const item of items) {
    pushToUser(item.userId, 'notification', item);
  }
}
