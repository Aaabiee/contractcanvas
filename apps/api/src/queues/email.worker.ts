import { Worker } from 'bullmq';
import { sendEmail, type SendEmailOpts } from '../services/email.service.js';
import { sendEmail as sendAdminAlert } from '../services/email.service.js';
import { logger } from '../lib/logger.js';
import { connection } from './index.js';

export type EmailJobData = SendEmailOpts;

export function startEmailWorker(): Worker | null {
  if (!connection) return null;

  const worker = new Worker<EmailJobData>(
    'email',
    async (job) => {
      await sendEmail(job.data);
    },
    { connection, concurrency: 5 },
  );

  worker.on('failed', async (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Email job failed');

    if (job && (job.attemptsMade ?? 0) >= (job.opts?.attempts ?? 5)) {
      const adminEmail = process.env['ADMIN_ALERT_EMAIL'];
      if (adminEmail) {
        await sendAdminAlert({
          to:       adminEmail,
          subject:  `[ContractCanvas] Dead-letter: email job ${job.id} failed`,
          textBody: `Job ${job.id} failed after ${job.attemptsMade} attempts.\n\nRecipient: ${job.data.to}\nSubject: ${job.data.subject}\n\nError: ${err.message}`,
          htmlBody: `<p>Job ${job.id} failed after ${job.attemptsMade} attempts.</p><p>To: ${job.data.to}</p><p>Subject: ${job.data.subject}</p><pre>${err.message}</pre>`,
        }).catch(() => {});
      }
    }
  });

  return worker;
}
