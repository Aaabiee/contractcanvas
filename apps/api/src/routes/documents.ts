// apps/api/src/routes/documents.ts
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

// Router
export const router = Router();

// ---------- Multer (memory) ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// Cast once so router accepts it regardless of subtle typing differences
const singleFileUpload: RequestHandler = upload.single('file') as unknown as RequestHandler;

// ---------- S3 client ----------
const s3 = new S3Client({
  region: s3Config.region ?? 'us-east-1',
  endpoint: s3Config.endpoint,
  forcePathStyle: s3Config.forcePathStyle ?? true,
  credentials:
    s3Config.accessKey && s3Config.secretKey
      ? { accessKeyId: s3Config.accessKey, secretAccessKey: s3Config.secretKey }
      : undefined, // use default provider chain if not provided
});

// ---------- Schemas ----------
const UploadMetaSchema = z.object({
  matterId: z.string().cuid(),
  // In a real app, organizationId should come from req.user (auth context)
  organizationId: z.string().cuid(),
  versionId: z.string().cuid().optional(),
  kind: z.enum(['UPLOADED', 'GENERATED', 'SIGNED_PDF', 'ATTACHMENT']).default('UPLOADED'),
});

// ---------- Routes ----------

// POST /api/documents/upload (Upload + create DB record)
router.post('/upload', singleFileUpload, async (req, res, next) => {
  try {
    // TS: assert file to avoid type mismatches from differing express d.ts
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate metadata from multipart/form-data fields
    const metaValidation = UploadMetaSchema.safeParse(req.body);
    if (!metaValidation.success) {
      return res
        .status(400)
        .json({ error: 'Invalid metadata', details: metaValidation.error.flatten() });
    }
    const metadata = metaValidation.data;

    // Build a unique storage key
    const fileExtension = file.originalname.split('.').pop() ?? '';
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const storageKey = `orgs/${metadata.organizationId}/matters/${metadata.matterId}/${uniqueSuffix}${
      fileExtension ? '.' + fileExtension : ''
    }`;

    // Upload to S3/MinIO
    await s3.send(
      new PutObjectCommand({
        Bucket: s3Config.bucket,
        Key: storageKey,
        Body: file.buffer,
        ContentType: file.mimetype,
        // ContentDisposition: `attachment; filename="${file.originalname}"`, // optional
      }),
    );

    // Create document record
    const document = await prisma.document.create({
      data: {
        organizationId: metadata.organizationId, // TODO: replace with req.user.organizationId
        matterId: metadata.matterId,
        versionId: metadata.versionId,
        filename: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        kind: metadata.kind,
        // status defaults to ACTIVE
      },
    });

    res.status(201).json(document);
  } catch (error) {
    next(error);
  }
});

// GET /api/documents?matterId=...
router.get('/', async (req, res, next) => {
  try {
    const { matterId } = req.query;
    if (!matterId || typeof matterId !== 'string') {
      return res.status(400).json({ error: 'matterId query parameter is required' });
    }

    const documents = await prisma.document.findMany({
      where: {
        matterId,
        // organizationId: req.user.organizationId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(documents);
  } catch (error) {
    next(error);
  }
});

// GET /api/documents/:id (metadata)
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const document = await prisma.document.findUnique({
      where: { id /*, organizationId: req.user.organizationId */ },
    });

    if (!document || document.deletedAt) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json(document);
  } catch (error) {
    next(error);
  }
});

// GET /api/documents/:id/download (signed URL)
router.get('/:id/download', async (req, res, next) => {
  try {
    const { id } = req.params;

    const document = await prisma.document.findUnique({
      where: { id /*, organizationId: req.user.organizationId */ },
    });

    if (!document || document.deletedAt) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const command = new GetObjectCommand({
      Bucket: s3Config.bucket,
      Key: document.storageKey,
      ResponseContentDisposition: `attachment; filename="${document.filename}"`,
    });

    // Presign for 5 minutes
    const url = await getSignedUrl(s3, command, { expiresIn: 300 });

    res.json({ url });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/documents/:id (soft delete)
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    await prisma.document.update({
      where: { id /*, organizationId: req.user.organizationId */ },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });

    // Optionally: schedule background deletion from S3
    res.status(204).send();
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ error: 'Document not found' });
    }
    next(error);
  }
});

export default router;
