import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../prisma.js';

export const router = Router();

const ALLOWED_PERIODS = ['30d', '90d', '1y'] as const;
type Period = typeof ALLOWED_PERIODS[number];

function periodToDays(period: Period): number {
  if (period === '30d') return 30;
  if (period === '90d') return 90;
  return 365;
}

function requireAdminOrOwner(req: Request, res: Response): boolean {
  const orgRole = req.user?.orgRole;
  if (orgRole !== 'OWNER' && orgRole !== 'ADMIN') {
    res.status(403).json({ error: 'forbidden', message: 'Only OWNER or ADMIN may access analytics.' });
    return false;
  }
  return true;
}

router.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }
    if (!requireAdminOrOwner(req, res)) return;

    const [matterGroups, contractGroups, overdueTaskCount, documentAgg, memberCount] = await Promise.all([
      prisma.matter.groupBy({
        by: ['status'],
        where: { organizationId, deletedAt: null },
        _count: true,
      }),
      prisma.contract.groupBy({
        by: ['status'],
        where: { organizationId, deletedAt: null },
        _count: { status: true },
        _sum: { valueCents: true },
      }),
      prisma.task.count({
        where: { organizationId, completedAt: null, dueAt: { lt: new Date() } },
      }),
      prisma.document.aggregate({
        where: { organizationId, status: 'ACTIVE' },
        _count: { id: true },
        _sum: { sizeBytes: true },
      }),
      prisma.organizationMember.count({ where: { organizationId } }),
    ]);

    const matters = {
      open:    0,
      on_hold: 0,
      closed:  0,
      total:   0,
    };
    for (const g of matterGroups) {
      const cnt = g._count as number;
      if (g.status === 'OPEN')    matters.open    = cnt;
      if (g.status === 'ON_HOLD') matters.on_hold = cnt;
      if (g.status === 'CLOSED')  matters.closed  = cnt;
      matters.total += cnt;
    }

    const byStatus: Record<string, number> = {
      DRAFT: 0, NEGOTIATION: 0, PENDING_SIGNATURE: 0, EXECUTED: 0, ARCHIVED: 0,
    };
    let totalValueCents = 0;
    for (const g of contractGroups) {
      byStatus[g.status] = g._count.status;
      totalValueCents += g._sum.valueCents ?? 0;
    }

    res.json({
      matters,
      contracts: { byStatus, totalValueCents },
      tasks:     { overdue: overdueTaskCount },
      documents: { count: documentAgg._count.id, totalSizeBytes: documentAgg._sum.sizeBytes ?? 0 },
      members:   { active: memberCount },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/contract-trends', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }
    if (!requireAdminOrOwner(req, res)) return;

    const rawPeriod = req.query.period ?? '30d';
    if (typeof rawPeriod !== 'string' || !(ALLOWED_PERIODS as readonly string[]).includes(rawPeriod)) {
      return res.status(400).json({ error: 'Invalid period. Must be one of: 30d, 90d, 1y.' });
    }
    const period = rawPeriod as Period;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodToDays(period));

    const orgId = organizationId;
    const rows = await prisma.$queryRaw<{ week: Date; count: bigint; totalValueCents: bigint }[]>`
      SELECT
        date_trunc('week', "createdAt") AS week,
        COUNT(*) AS count,
        COALESCE(SUM("valueCents"), 0) AS "totalValueCents"
      FROM "Contract"
      WHERE "organizationId" = ${orgId} AND "deletedAt" IS NULL
        AND "createdAt" >= ${startDate}
      GROUP BY week
      ORDER BY week ASC
    `;

    const trends = rows.map(r => ({
      week:            r.week,
      count:           Number(r.count),
      totalValueCents: Number(r.totalValueCents),
    }));

    res.json({ period, trends });
  } catch (error) {
    next(error);
  }
});

export default router;
