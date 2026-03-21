import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { logger } from '../lib/logger.js';
import { writeAuditLog } from '../lib/audit.js';

const SUPPORT_SECRET = process.env['PLATFORM_SUPPORT_SECRET'];
const SUPPORT_TOKEN_TTL_MS = 30 * 60 * 1000;

interface SupportToken {
  orgId: string;
  agentId: string;
  expiresAt: number;
}

export const activeTokens = new Map<string, SupportToken>();

export function generateSupportToken(orgId: string, agentId: string): string {
  if (!SUPPORT_SECRET) throw new Error('PLATFORM_SUPPORT_SECRET not configured');

  const token = crypto.randomBytes(32).toString('hex');
  activeTokens.set(token, {
    orgId,
    agentId,
    expiresAt: Date.now() + SUPPORT_TOKEN_TTL_MS,
  });
  return token;
}

export function supportAccessGuard(req: Request, res: Response, next: NextFunction): void {
  const token = req.header('X-Support-Token');
  if (!token) { next(); return; }

  const entry = activeTokens.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    activeTokens.delete(token!);
    res.status(401).json({ error: 'Invalid or expired support token' });
    return;
  }

  if (req.method !== 'GET') {
    res.status(403).json({ error: 'Support access is read-only' });
    return;
  }

  req.user = {
    id:             `support:${entry.agentId}`,
    roles:          ['SUPPORT'],
    organizationId: entry.orgId,
    organizations:  [{ id: entry.orgId, name: 'support', slug: 'support', role: 'MEMBER' }],
  };

  writeAuditLog({
    organizationId: entry.orgId,
    actorId:        `support:${entry.agentId}`,
    entity:         'SupportAccess',
    entityId:       req.path,
    action:         'READ',
    ip:             req.ip,
    userAgent:      req.headers['user-agent'],
  }).catch(() => {});

  logger.info({ agentId: entry.agentId, orgId: entry.orgId, path: req.path }, 'Platform support access');

  next();
}

export function revokeSupportToken(token: string): boolean {
  return activeTokens.delete(token);
}
