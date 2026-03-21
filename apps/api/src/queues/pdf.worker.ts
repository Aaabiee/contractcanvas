import { Worker } from 'bullmq';
import { logger } from '../lib/logger.js';
import { connection } from './index.js';

export interface PdfJobData {
  contractId:     string;
  organizationId: string;
  requestedById:  string;
}

export function startPdfWorker(): Worker | null {
  if (!connection) return null;

  const worker = new Worker<PdfJobData>(
    'pdf',
    async (job) => {
      const { generateContractPdf } = await import('../services/pdf.service.js');
      const prisma = (await import('../prisma.js')).default;

      const contract = await prisma.contract.findFirst({
        where:   { id: job.data.contractId, organizationId: job.data.organizationId },
        include: { matter: true, versions: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });

      if (!contract) {
        throw new Error(`Contract ${job.data.contractId} not found`);
      }

      const pdfBuffer = await generateContractPdf(contract as any);

      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const config = await import('../config.js');
      const s3Config = config.s3;
      const crypto = await import('node:crypto');

      const s3 = new S3Client({
        region:         s3Config.region ?? 'us-east-1',
        endpoint:       s3Config.endpoint,
        forcePathStyle: s3Config.forcePathStyle ?? true,
        credentials:    s3Config.accessKey && s3Config.secretKey
          ? { accessKeyId: s3Config.accessKey, secretAccessKey: s3Config.secretKey }
          : undefined,
      });

      const key = `orgs/${job.data.organizationId}/contracts/${job.data.contractId}/generated-${crypto.default.randomBytes(4).toString('hex')}.pdf`;
      await s3.send(new PutObjectCommand({
        Bucket:      s3Config.bucket,
        Key:         key,
        Body:        pdfBuffer,
        ContentType: 'application/pdf',
      }));

      await prisma.document.create({
        data: {
          organizationId: job.data.organizationId,
          matterId:       contract.matterId,
          versionId:      contract.versions[0]?.id,
          filename:       `${contract.title.replace(/[^\w\s-]/g, '').trim()}.pdf`,
          storageKey:     key,
          mimeType:       'application/pdf',
          sizeBytes:      pdfBuffer.length,
          kind:           'GENERATED',
        },
      });
    },
    { connection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, contractId: job?.data?.contractId, err }, 'PDF job failed');
  });

  return worker;
}
