import { Worker } from 'bullmq';
import { logger } from '../lib/logger.js';
import { connection } from './index.js';

export interface CleanupJobData {
  type: 'retention' | 'expired-sessions';
}

export function startCleanupWorker(): Worker | null {
  if (!connection) return null;

  const worker = new Worker<CleanupJobData>(
    'cleanup',
    async (job) => {
      const prisma = (await import('../prisma.js')).default;

      if (job.data.type === 'expired-sessions') {
        const result = await prisma.session.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        });
        logger.info({ deleted: result.count }, 'Expired sessions cleaned up');
        return;
      }

      if (job.data.type === 'retention') {
        const orgs = await prisma.organization.findMany({
          select: { id: true, retentionDays: true },
        });

        for (const org of orgs) {
          const cutoff = new Date(Date.now() - org.retentionDays * 24 * 60 * 60 * 1000);

          const matters = await prisma.matter.findMany({
            where: {
              organizationId: org.id,
              status: 'CLOSED',
              updatedAt: { lt: cutoff },
            },
            select: { id: true },
          });

          if (matters.length === 0) continue;

          const matterIds = matters.map(m => m.id);
          const docsToDelete = await prisma.document.findMany({
            where: { matterId: { in: matterIds }, deletedAt: null },
            select: { id: true, filename: true },
          });

          logger.info(
            { orgId: org.id, matters: matters.length, docs: docsToDelete.length },
            'Retention: scheduling document deletion',
          );

          await prisma.document.updateMany({
            where: { id: { in: docsToDelete.map(d => d.id) } },
            data:  { deletedAt: new Date() },
          });
        }
      }
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, type: job?.data?.type, err }, 'Cleanup job failed');
  });

  return worker;
}
