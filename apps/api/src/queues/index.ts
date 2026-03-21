import { Queue, Worker, QueueEvents } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';

const REDIS_URL = process.env['REDIS_URL'];

export let connection: ConnectionOptions | null = null;

if (REDIS_URL) {
  const url = new URL(REDIS_URL);
  connection = {
    host:     url.hostname,
    port:     Number(url.port) || 6379,
    password: url.password || undefined,
    db:       url.pathname ? Number(url.pathname.slice(1)) || 0 : 0,
  };
}

export const DEFAULT_JOB_OPTIONS = {
  attempts:  5,
  backoff:   { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { count: 500 },
  removeOnFail:     { count: 200 },
};

export let emailQueue:   Queue | null = null;
export let webhookQueue: Queue | null = null;
export let pdfQueue:     Queue | null = null;
export let cleanupQueue: Queue | null = null;

export function initQueues(): void {
  if (!connection) return;

  emailQueue   = new Queue('email',   { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  webhookQueue = new Queue('webhook', { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  pdfQueue     = new Queue('pdf',     { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  cleanupQueue = new Queue('cleanup', { connection, defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 3 } });
}

export function getQueues(): Queue[] {
  return [emailQueue, webhookQueue, pdfQueue, cleanupQueue].filter((q): q is Queue => q !== null);
}

export { QueueEvents };
