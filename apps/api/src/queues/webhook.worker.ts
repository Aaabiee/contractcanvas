import { Worker } from 'bullmq';
import { deliverWebhook } from '../services/webhook.service.js';
import { logger } from '../lib/logger.js';
import { connection } from './index.js';

export interface WebhookJobData {
  organizationId: string;
  event:          string;
  payload:        object;
}

export function startWebhookWorker(): Worker | null {
  if (!connection) return null;

  const worker = new Worker<WebhookJobData>(
    'webhook',
    async (job) => {
      await deliverWebhook(job.data.organizationId, job.data.event, job.data.payload);
    },
    { connection, concurrency: 10 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Webhook job failed');
  });

  return worker;
}
