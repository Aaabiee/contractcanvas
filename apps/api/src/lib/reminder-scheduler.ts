import cron from 'node-cron';
import prisma from '../prisma.js';
import { createNotifications } from './notify.js';
import { emailQueue } from '../queues/index.js';

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

      const allNotifications = due.flatMap(r =>
        (membersByOrg.get(r.organizationId) ?? []).map(userId => ({
          userId,
          organizationId: r.organizationId,
          type:  'REMINDER' as const,
          title: `Reminder: ${r.type} — ${r.contract.title}`,
          body:  `A ${r.type.toLowerCase()} reminder is due for contract "${r.contract.title}".`,
          data:  { contractId: r.contractId },
        })),
      );

      await createNotifications(allNotifications);
      await prisma.reminder.updateMany({
        where: { id: { in: due.map(r => r.id) } },
        data:  { sentAt: now },
      });

      console.log(`[reminder-scheduler] Sent ${due.length} reminder(s) at ${now.toISOString()}`);
    } catch (err) {
      console.error('[reminder-scheduler] Error:', err);
    }
  });

  cron.schedule('0 9 * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const stuckUsers = await prisma.user.findMany({
        where: {
          onboardingStep: { not: 'DONE' },
          createdAt:      { lt: cutoff },
          deletedAt:      null,
          emailVerifiedAt: { not: null },
        },
        select: { id: true, email: true, firstName: true, onboardingStep: true },
      });

      if (stuckUsers.length === 0) return;

      for (const user of stuckUsers) {
        if (emailQueue) {
          await emailQueue.add('send', {
            to:       user.email,
            subject:  'Finish setting up your ContractCanvas workspace',
            htmlBody: `<p>Hi ${user.firstName},</p><p>You're almost there! Complete your setup to start managing contracts.</p><p><a href="${process.env.FRONTEND_URL ?? 'http://localhost:4200'}/onboarding">Continue setup</a></p>`,
            textBody: `Hi ${user.firstName},\n\nFinish setting up your workspace: ${process.env.FRONTEND_URL ?? 'http://localhost:4200'}/onboarding`,
          });
        }
      }

      console.log(`[onboarding-nudge] Sent ${stuckUsers.length} reminder(s)`);
    } catch (err) {
      console.error('[onboarding-nudge] Error:', err);
    }
  });
}
