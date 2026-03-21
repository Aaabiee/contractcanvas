import cron from 'node-cron';
import prisma from '../prisma.js';

export function startReminderScheduler(): void {
  cron.schedule('* * * * *', async () => {
    try {
      const due = await prisma.reminder.findMany({
        where: { sentAt: null, dueAt: { lte: new Date() } },
        include: {
          contract:     { select: { id: true, title: true } },
          organization: { select: { id: true } },
        },
      });

      if (due.length === 0) return;

      const members = await prisma.organizationMember.findMany({
        where: { organizationId: { in: [...new Set(due.map(r => r.organizationId))] } },
        select: { userId: true, organizationId: true },
      });

      const membersByOrg = new Map<string, string[]>();
      for (const m of members) {
        const list = membersByOrg.get(m.organizationId) ?? [];
        list.push(m.userId);
        membersByOrg.set(m.organizationId, list);
      }

      const now = new Date();

      await prisma.$transaction([
        ...due.map(r =>
          prisma.notification.createMany({
            data: (membersByOrg.get(r.organizationId) ?? []).map(userId => ({
              userId,
              organizationId: r.organizationId,
              type:  'REMINDER' as const,
              title: `Reminder: ${r.type} — ${r.contract.title}`,
              body:  `A ${r.type.toLowerCase()} reminder is due for contract "${r.contract.title}".`,
              data:  { contractId: r.contractId },
            })),
            skipDuplicates: true,
          }),
        ),
        prisma.reminder.updateMany({
          where: { id: { in: due.map(r => r.id) } },
          data:  { sentAt: now },
        }),
      ]);

      console.log(`[reminder-scheduler] Sent ${due.length} reminder(s) at ${now.toISOString()}`);
    } catch (err) {
      console.error('[reminder-scheduler] Error:', err);
    }
  });
}
