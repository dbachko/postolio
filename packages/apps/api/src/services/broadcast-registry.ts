import type { StatusBroadcaster } from './status-broadcaster.js';
import type { NotificationsBroadcaster } from './notifications-broadcaster.js';

let broadcasterRef: StatusBroadcaster | null = null;
let notificationsBroadcasterRef: NotificationsBroadcaster | null = null;

export function setStatusBroadcaster(b: StatusBroadcaster) {
  broadcasterRef = b;
}

export function getStatusBroadcaster(): StatusBroadcaster | null {
  return broadcasterRef;
}

export function setNotificationsBroadcaster(b: NotificationsBroadcaster) {
  notificationsBroadcasterRef = b;
}

export function getNotificationsBroadcaster(): NotificationsBroadcaster | null {
  return notificationsBroadcasterRef;
}
