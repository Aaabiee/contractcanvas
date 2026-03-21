import type { Response } from 'express';

const clients = new Map<string, Set<Response>>();

export function addClient(userId: string, res: Response): void {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId)!.add(res);
}

export function removeClient(userId: string, res: Response): void {
  clients.get(userId)?.delete(res);
  if (clients.get(userId)?.size === 0) clients.delete(userId);
}

export function pushToUser(userId: string, event: string, data: unknown): void {
  const conns = clients.get(userId);
  if (!conns?.size) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of conns) {
    try { res.write(payload); } catch { removeClient(userId, res); }
  }
}

export function connectedUserCount(): number {
  return clients.size;
}
