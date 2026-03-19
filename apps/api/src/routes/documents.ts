import express, { Router, type RequestHandler } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import prisma from '../prisma.js';
import { s3 as s3Config } from '../config.js';

export const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const singleFileUpload: RequestHandler = upload.single('file') as unknown as RequestHandler;

const s3 = new S3Client({
  region: s3Config.region ?? 'us-east-1',
  endpoint: s3Config.endpoint,
  forcePathStyle: s3Config.forcePathStyle ?? true,
  credentials:
    s3Config.accessKey && s3Config.secretKey
      ? { accessKeyId: s3Config.accessKey, secretAccessKey: s3Config.secretKey }
      : undefined,
});

const UploadMetaSchema = z.object({
  matterId:  z.string().cuid(),
  versionId: z.string().cuid().optional(),
  kind:      z.enum(['UPLOADED', 'GENERATED', 'SIGNED_PDF', 'ATTACHMENT']).default('UPLOADED'),
});

router.post('/upload', singleFileUpload, async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const metaValidation = UploadMetaSchema.safeParse(req.body);
    if (!metaValidation.success) {
      return res.status(400).json({ error: 'Invalid metadata', details: metaValidation.error.flatten() });
    }
    const metadata = metaValidation.data;

    const matter = await prisma.matter.findFirst({ where: { id: metadata.matterId, organizationId, deletedAt: null } });
    if (!matter) {
      return res.status(404).json({ error: 'Matter not found' });
    }

    const fileExtension = file.originalname.split('.').pop() ?? '';
    const uniqueSuffix  = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const storageKey    = `orgs/${organizationId}/matters/${metadata.matterId}/${uniqueSuffix}${fileExtension ? '.' + fileExtension : ''}`;

    await s3.send(new PutObjectCommand({
      Bucket:      s3Config.bucket,
      Key:         storageKey,
      Body:        file.buffer,
      ContentType: file.mimetype,
    }));

    const document = await prisma.document.create({
      data: {
        organizationId,
        matterId:  metadata.matterId,
        versionId: metadata.versionId,
        filename:  file.originalname,
        storageKey,
        mimeType:  file.mimetype,
        sizeBytes: file.size,
        kind:      metadata.kind,
      },
    });

    res.status(201).json(document);
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    const { matterId } = req.query;
    if (!matterId || typeof matterId !== 'string') {
      return res.status(400).json({ error: 'matterId query parameter is required' });
    }

    const documents = await prisma.document.findMany({
      where: { matterId, organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    res.json(documents);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    const { id } = req.params;
    const document = await prisma.document.findFirst({
      where: { id, organizationId, deletedAt: null },
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json(document);
  } catch (error) {
    next(error);
  }
});

router.get('/:id/download', async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    const { id } = req.params;
    const document = await prisma.document.findFirst({
      where: { id, organizationId, deletedAt: null },
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const command = new GetObjectCommand({
      Bucket:                     s3Config.bucket,
      Key:                        document.storageKey,
      ResponseContentDisposition: `attachment; filename="${document.filename}"`,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 300 });
    res.json({ url });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    const { id } = req.params;
    const existing = await prisma.document.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!existing) {
      return res.status(404).json({ error: 'Document not found' });
    }

    await prisma.document.update({ where: { id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
