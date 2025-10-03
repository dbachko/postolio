import type { StatusBroadcaster } from './status-broadcaster.js';

let broadcasterRef: StatusBroadcaster | null = null;

export function setStatusBroadcaster(b: StatusBroadcaster) {
  broadcasterRef = b;
}

export function getStatusBroadcaster(): StatusBroadcaster | null {
  return broadcasterRef;
}
