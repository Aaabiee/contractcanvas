import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { generateContractPdf } from '../services/pdf.service.js';

export const router = Router();

const CreateContractSchema = z.object({
  title:      z.string().min(1),
  matterId:   z.string().cuid(),
  valueCents: z.number().int().optional(),
  currency:   z.string().optional(),
});

const UpdateContractSchema = z.object({
  title:      z.string().min(1).optional(),
  status:     z.enum(['DRAFT', 'NEGOTIATION', 'PENDING_SIGNATURE', 'EXECUTED', 'ARCHIVED']).optional(),
  valueCents: z.number().int().optional().nullable(),
  currency:   z.string().optional(),
});

const CreateVersionSchema = z.object({
  storageKey: z.string().min(1),
  mimeType:   z.string().optional(),
  sizeBytes:  z.number().int().optional(),
  title:      z.string().optional(),
  diffJson:   z.record(z.unknown()).optional(),
  aiContext:  z.record(z.unknown()).optional(),
});

const orgGuard = (req: Request, res: Response): string | null => {
  const id = req.user?.organizationId;
  if (!id) res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
  return id ?? null;
};

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const { matterId, status, limit = '50', offset = '0' } = req.query;
    const take = Math.min(Number(limit), 100);
    const skip = Number(offset);

    const where: any = {
      organizationId,
      deletedAt: null,
      ...(matterId && typeof matterId === 'string' ? { matterId } : {}),
      ...(status   && typeof status   === 'string' ? { status: status as any } : {}),
    };

    const [contracts, total] = await Promise.all([
      prisma.contract.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          matter:         { select: { id: true, title: true } },
          currentVersion: { select: { id: true, number: true, title: true, createdAt: true } },
          _count:         { select: { versions: true } },
        },
      }),
      prisma.contract.count({ where }),
    ]);

    res.json({ data: contracts, total, limit: take, offset: skip });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const validation = CreateContractSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }
    const { title, matterId, valueCents, currency } = validation.data;

    const matter = await prisma.matter.findFirst({ where: { id: matterId, organizationId, deletedAt: null } });
    if (!matter) {
      return res.status(404).json({ error: 'Matter not found' });
    }

    const newContract = await prisma.contract.create({
      data: { title, matterId, organizationId, valueCents, currency },
    });
    res.status(201).json(newContract);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const { id } = req.params;
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        matter:         { select: { id: true, title: true, status: true } },
        versions:       { orderBy: { number: 'desc' }, include: { author: { select: { id: true, firstName: true, lastName: true } } } },
        currentVersion: true,
        _count:         { select: { signatureEnvelopes: true } },
      },
    });
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }
    res.json(contract);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const { id } = req.params;
    const validation = UpdateContractSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }

    const existing = await prisma.contract.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!existing) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const updatedContract = await prisma.contract.update({ where: { id }, data: validation.data });
    res.json(updatedContract);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const { id } = req.params;
    const existing = await prisma.contract.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!existing) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    await prisma.contract.update({ where: { id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post('/:contractId/versions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const authorId = req.user?.id;
    const { contractId } = req.params;

    const validation = CreateVersionSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }
    const data = validation.data;

    const contract = await prisma.contract.findFirst({ where: { id: contractId, organizationId, deletedAt: null } });
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const newVersion = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const latest = await tx.contractVersion.findFirst({
        where:   { contractId },
        orderBy: { number: 'desc' },
        select:  { number: true },
      });
      const nextNumber = (latest?.number ?? 0) + 1;

      const version = await tx.contractVersion.create({
        data: {
          contractId,
          number:     nextNumber,
          authorId,
          storageKey: data.storageKey,
          mimeType:   data.mimeType,
          sizeBytes:  data.sizeBytes,
          title:      data.title ?? `Version ${nextNumber}`,
          diffJson:   data.diffJson as Prisma.InputJsonValue ?? Prisma.JsonNull,
          aiContext:  data.aiContext as Prisma.InputJsonValue ?? Prisma.JsonNull,
        },
      });

      await tx.contract.update({
        where: { id: contractId },
        data:  { currentVersionId: version.id },
      });

      return version;
    });

    res.status(201).json(newVersion);
  } catch (error) {
    next(error);
  }
});

router.get('/:contractId/versions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const { contractId } = req.params;

    const contract = await prisma.contract.findFirst({ where: { id: contractId, organizationId } });
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const versions = await prisma.contractVersion.findMany({
      where:   { contractId },
      orderBy: { number: 'desc' },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    res.json(versions);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/generate-pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const contract = await prisma.contract.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        organization:   { select: { name: true } },
        currentVersion: { select: { number: true, title: true } },
      },
    });
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generateContractPdf({
        title:       contract.title,
        status:      contract.status,
        valueCents:  contract.valueCents,
        currency:    contract.currency ?? undefined,
        orgName:     contract.organization.name,
        version:     contract.currentVersion
          ? `v${contract.currentVersion.number}${contract.currentVersion.title ? ` – ${contract.currentVersion.title}` : ''}`
          : undefined,
        generatedAt: new Date(),
      });
    } catch (err: any) {
      if (err.message?.includes('puppeteer not installed')) {
        return res.status(503).json({ error: 'pdf_unavailable', message: 'PDF generation is not configured on this server.' });
      }
      throw err;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${contract.id}-${Date.now()}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

export default router;
