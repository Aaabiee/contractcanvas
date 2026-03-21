import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import prisma from '../prisma.js';
import { protect } from '../middleware/auth.js';

export const router = Router({ mergeParams: true });

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function requireOrgAccess(req: Request, res: Response): string | null {
  const { orgId } = req.params as { orgId: string };
  if (!req.user || req.user.organizationId !== orgId) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  const orgRole = req.user.organizations?.find((o: { id: string }) => o.id === orgId)?.role;
  if (orgRole !== 'OWNER' && orgRole !== 'ADMIN') {
    res.status(403).json({ error: 'forbidden', message: 'Only OWNER or ADMIN can manage API keys' });
    return null;
  }
  return orgId;
}

router.get('/', protect, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrgAccess(req, res);
    if (!orgId) return;

    const keys = await prisma.apiKey.findMany({
      where:   { organizationId: orgId, revokedAt: null },
      select:  { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true, revokedAt: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ keys });
  } catch (err) {
    next(err);
  }
});

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

router.post('/', protect, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrgAccess(req, res);
    if (!orgId) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }

    const rawKey   = `cc_live_${crypto.randomBytes(48).toString('hex')}`;
    const hashed   = hashKey(rawKey);
    const prefix   = rawKey.slice(0, 16);

    const apiKey = await prisma.apiKey.create({
      data:   { organizationId: orgId, name: parsed.data.name, hashedKey: hashed, prefix },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true, revokedAt: true },
    });

    res.status(201).json({ key: { ...apiKey, rawKey } });
  } catch (err) {
    next(err);
  }
});

router.delete('/:keyId', protect, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrgAccess(req, res);
    if (!orgId) return;

    const { keyId } = req.params as { keyId: string };

    const existing = await prisma.apiKey.findFirst({
      where: { id: keyId, organizationId: orgId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'API key not found' });
    }

    await prisma.apiKey.update({
      where: { id: keyId },
      data:  { revokedAt: new Date() },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
