import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';

const router = Router();
export default router;

const QuerySchema = z.object({
  q:     z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  mode:  z.enum(['fts', 'like']).default('fts'),
});

async function hasTsvector(): Promise<boolean> {
  try {
    const result: any[] = await prisma.$queryRaw`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'Matter' AND column_name = 'search_tsv' LIMIT 1`;
    return result.length > 0;
  } catch {
    return false;
  }
}

let useFts: boolean | null = null;

async function shouldUseFts(): Promise<boolean> {
  if (useFts === null) useFts = await hasTsvector();
  return useFts;
}

function toTsQuery(q: string): string {
  return q.trim().split(/\s+/).filter(Boolean).map(w => w.replace(/[^\w]/g, '')).filter(Boolean).join(' & ');
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    const { q, limit, mode: requestedMode } = parsed.data;
    const fts = requestedMode === 'fts' && await shouldUseFts();

    let matters: any[], contracts: any[], documents: any[];

    if (fts) {
      const tsq = toTsQuery(q);
      if (!tsq) {
        return res.json({ q, total: 0, matters: [], contracts: [], documents: [] });
      }

      [matters, contracts, documents] = await Promise.all([
        prisma.$queryRaw<any[]>`
          SELECT id, title, description, status, "createdAt"
          FROM "Matter"
          WHERE "organizationId" = ${organizationId}
            AND "deletedAt" IS NULL
            AND "search_tsv" @@ to_tsquery('english', ${tsq})
          ORDER BY ts_rank("search_tsv", to_tsquery('english', ${tsq})) DESC
          LIMIT ${limit}`,

        prisma.$queryRaw<any[]>`
          SELECT id, title, status, "matterId", "createdAt"
          FROM "Contract"
          WHERE "organizationId" = ${organizationId}
            AND "deletedAt" IS NULL
            AND "search_tsv" @@ to_tsquery('english', ${tsq})
          ORDER BY ts_rank("search_tsv", to_tsquery('english', ${tsq})) DESC
          LIMIT ${limit}`,

        prisma.$queryRaw<any[]>`
          SELECT id, filename, "mimeType", "matterId", "versionId", "createdAt"
          FROM "Document"
          WHERE "organizationId" = ${organizationId}
            AND "deletedAt" IS NULL
            AND "search_tsv" @@ to_tsquery('english', ${tsq})
          ORDER BY ts_rank("search_tsv", to_tsquery('english', ${tsq})) DESC
          LIMIT ${limit}`,
      ]);
    } else {
      const mode = 'insensitive' as const;
      [matters, contracts, documents] = await Promise.all([
        prisma.matter.findMany({
          where: {
            organizationId, deletedAt: null,
            OR: [{ title: { contains: q, mode } }, { description: { contains: q, mode } }],
          },
          select: { id: true, title: true, description: true, status: true, createdAt: true },
          take: limit,
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.contract.findMany({
          where: { organizationId, deletedAt: null, title: { contains: q, mode } },
          select: { id: true, title: true, status: true, matterId: true, createdAt: true },
          take: limit,
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.document.findMany({
          where: { organizationId, deletedAt: null, filename: { contains: q, mode } },
          select: { id: true, filename: true, mimeType: true, matterId: true, versionId: true, createdAt: true },
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
      ]);
    }

    const total = matters.length + contracts.length + documents.length;
    res.json({ q, total, matters, contracts, documents });
  } catch (err) {
    next(err);
  }
});
