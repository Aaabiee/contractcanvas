import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../prisma.js';

const router = Router();

function requireAdminOrOwner(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.orgRole;
  if (role !== 'OWNER' && role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

function buildWhere(organizationId: string, query: Request['query']) {
  const { entity, actorId, action, from, to } = query;
  const where: Record<string, unknown> = { organizationId };
  if (entity   && typeof entity   === 'string') where.entity   = entity;
  if (actorId  && typeof actorId  === 'string') where.actorId  = actorId;
  if (action   && typeof action   === 'string') where.action   = action;
  if (from || to) {
    const createdAt: Record<string, Date> = {};
    if (from && typeof from === 'string') createdAt.gte = new Date(from);
    if (to   && typeof to   === 'string') createdAt.lte = new Date(to);
    where.createdAt = createdAt;
  }
  return where;
}

function escapeCsvValue(value: unknown): string {
  let str = value === null || value === undefined ? '' : String(value);
  str = str.replace(/^[=+\-@]/, "'$&");
  return `"${str.replace(/"/g, '""')}"`;
}

router.get('/', requireAdminOrOwner, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    const take   = Math.min(Number(req.query.limit  ?? 50), 100);
    const skip   = Number(req.query.offset ?? 0);
    const where  = buildWhere(organizationId, req.query);

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ data, total, limit: take, offset: skip });
  } catch (error) {
    next(error);
  }
});

router.get('/export.csv', requireAdminOrOwner, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    const take  = Math.min(Number(req.query.limit  ?? 50), 100);
    const skip  = Number(req.query.offset ?? 0);
    const where = buildWhere(organizationId, req.query);

    const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take });

    const headers = ['id', 'organizationId', 'actorId', 'entity', 'entityId', 'action', 'ip', 'userAgent', 'createdAt'];
    const lines   = [
      headers.map(escapeCsvValue).join(','),
      ...rows.map(row =>
        headers.map(h => escapeCsvValue((row as Record<string, unknown>)[h])).join(',')
      ),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
    res.send(lines.join('\r\n'));
  } catch (error) {
    next(error);
  }
});

export default router;
