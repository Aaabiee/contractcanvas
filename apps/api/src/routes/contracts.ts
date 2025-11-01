// apps/api/src/routes/contracts.ts
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';
import { PrismaClient, Prisma } from '@prisma/client';

export const router = Router();

// --- Zod Schemas ---
const CreateContractSchema = z.object({
  title: z.string().min(1),
  matterId: z.string().cuid(),
  // TODO: Get organizationId from authenticated user context
  organizationId: z.string().cuid(),
  valueCents: z.number().int().optional(),
  currency: z.string().optional(),
});

const UpdateContractSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(['DRAFT', 'NEGOTIATION', 'PENDING_SIGNATURE', 'EXECUTED', 'ARCHIVED']).optional(),
  valueCents: z.number().int().optional().nullable(),
  currency: z.string().optional(),
});

const CreateVersionSchema = z.object({
    // TODO: Get authorId from authenticated user context
    authorId: z.string().cuid(),
    storageKey: z.string().min(1), // Key from S3/MinIO upload
    mimeType: z.string().optional(),
    sizeBytes: z.number().int().optional(),
    title: z.string().optional(),
    // diffJson, aiContext can be added later or via separate endpoints
});

// --- Contract Routes ---

// GET /api/contracts (List contracts for the org)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // TODO: Add auth/org checks + Filtering (e.g., by matterId from query params)
    // const organizationId = req.user.organizationId; // Example
    const contracts = await prisma.contract.findMany({
      // where: { organizationId }, // Filter by org
      orderBy: { createdAt: 'desc' },
      include: { matter: { select: { id: true, title: true } } } // Include basic matter info
    });
    res.json(contracts);
  } catch (error) {
    next(error);
  }
});

// POST /api/contracts (Create a new contract)
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // TODO: Add auth/org checks
    const validation = CreateContractSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }
    const data = validation.data;
    // TODO: Verify matterId belongs to the user's organization

    const newContract = await prisma.contract.create({
      data: {
        title: data.title,
        matterId: data.matterId,
        organizationId: data.organizationId, // Replace with req.user.organizationId
        valueCents: data.valueCents,
        currency: data.currency,
        // Status defaults to DRAFT
      },
    });
    res.status(201).json(newContract);
  } catch (error) {
    next(error);
  }
});

// GET /api/contracts/:id (Get specific contract)
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // TODO: Add auth/org checks
    const { id } = req.params;
    const contract = await prisma.contract.findUnique({
      where: { id /*, organizationId: req.user.organizationId */ },
      include: {
        matter: true,
        versions: { orderBy: { number: 'desc' } }, // Include versions, newest first
        currentVersion: true,
      }
    });
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }
    res.json(contract);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/contracts/:id (Update contract metadata/status)
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // TODO: Add auth/org checks
    const { id } = req.params;
    const validation = UpdateContractSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }

    const updatedContract = await prisma.contract.update({
      where: { id /*, organizationId: req.user.organizationId */ },
      data: validation.data,
    });
    res.json(updatedContract);
  } catch (error) {
     if ((error as any).code === 'P2025') { // Record not found
        return res.status(404).json({ error: 'Contract not found' });
    }
    next(error);
  }
});

// DELETE /api/contracts/:id (Soft delete)
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // TODO: Add auth/org checks
    const { id } = req.params;
    await prisma.contract.update({
      where: { id /*, organizationId: req.user.organizationId */ },
      data: { deletedAt: new Date() },
    });
    res.status(204).send();
  } catch (error) {
     if ((error as any).code === 'P2025') {
        return res.status(404).json({ error: 'Contract not found' });
    }
    next(error);
  }
});

// --- Contract Version Routes ---

// POST /api/contracts/:contractId/versions (Add a new version)
router.post('/:contractId/versions', async (req: Request, res: Response, next: NextFunction) => {
    try {
        // TODO: Add auth/org checks - verify contract belongs to org
        const { contractId } = req.params;
        const validation = CreateVersionSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
        }
        const data = validation.data;

        // Transaction to get the next version number and create the version
        const newVersion = await prisma.$transaction(async (tx: PrismaClient | Prisma.TransactionClient) => {
            const contract = await tx.contract.findUnique({
                where: { id: contractId },
                select: { versions: { orderBy: { number: 'desc' }, take: 1 } }
            });

            if (!contract) {
                throw new Error('Contract not found'); // Will be caught and sent as 404
            }

            const nextVersionNumber = (contract.versions[0]?.number ?? 0) + 1;

            return tx.contractVersion.create({
                data: {
                    contractId: contractId,
                    number: nextVersionNumber,
                    authorId: data.authorId, // Replace with req.user.id
                    storageKey: data.storageKey,
                    mimeType: data.mimeType,
                    sizeBytes: data.sizeBytes,
                    title: data.title ?? `Version ${nextVersionNumber}`,
                },
            });
        });

        // Optionally update the contract's currentVersionId
        // await prisma.contract.update({
        //     where: { id: contractId },
        //     data: { currentVersionId: newVersion.id }
        // });

        res.status(201).json(newVersion);
    } catch (error: any) {
         if (error.message === 'Contract not found') {
            return res.status(404).json({ error: 'Contract not found' });
        }
        next(error);
    }
});

// GET /api/contracts/:contractId/versions (List versions for a contract)
router.get('/:contractId/versions', async (req: Request, res: Response, next: NextFunction) => {
    try {
        // TODO: Add auth/org checks
        const { contractId } = req.params;
        const versions = await prisma.contractVersion.findMany({
            where: { contractId },
            orderBy: { number: 'desc' }, // Newest first
            include: { author: { select: { id: true, name: true } } }
        });
        res.json(versions);
    } catch (error) {
        next(error);
    }
});

export default router;