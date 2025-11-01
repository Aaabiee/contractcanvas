// apps/api/src/routes/matters.ts
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';

export const router = Router();

// --- Zod Schemas ---
const CreateMatterSchema = z.object({
  title: z.string().min(1, { message: 'Title is required' }),
  description: z.string().optional(),
  // IMPORTANT: Remove these once auth middleware provides context
  ownerId: z.string().cuid({ message: 'Valid owner ID required' }),
  organizationId: z.string().cuid({ message: 'Valid organization ID required' }),
});

const UpdateMatterSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(['OPEN', 'ON_HOLD', 'CLOSED']).optional(), // Use enum values from Prisma schema
});

// --- Routes ---

// GET /api/matters - List all matters (needs org scoping later)
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // !! IMPORTANT: Add filtering by req.user.organizationId once auth is integrated !!
    const matters = await prisma.matter.findMany({
      orderBy: { createdAt: 'desc' },
      // Example: include owner info
      // include: { owner: { select: { id: true, name: true, email: true } } }
    });
    res.json(matters);
  } catch (error) {
    next(error);
  }
});

// GET /api/matters/:id - Get a single matter by ID
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    // !! IMPORTANT: Add filtering by req.user.organizationId !!
    const matter = await prisma.matter.findUnique({
      where: { id },
      // Example: include related data
      // include: { owner: true, participants: true, documents: true, contracts: true }
    });

    if (!matter) {
      return res.status(404).json({ error: 'Matter not found' });
    }
    res.json(matter);
  } catch (error) {
    next(error);
  }
});

// POST /api/matters - Create a new matter
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = CreateMatterSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }

    // !! IMPORTANT: Replace ownerId and organizationId with values from req.user (auth context) !!
    const { title, description, ownerId, organizationId } = validation.data;
    // const ownerId = req.user.id;
    // const organizationId = req.user.organizationId;

    const newMatter = await prisma.matter.create({
      data: {
        title,
        description,
        ownerId,
        organizationId,
        // Status defaults to OPEN per schema
      },
    });
    res.status(201).json(newMatter);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/matters/:id - Update an existing matter
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const validation = UpdateMatterSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }

    // !! IMPORTANT: Add check to ensure user has permission to update this matter !!
    // e.g., fetch matter and check if req.user.organizationId matches matter.organizationId

    const updatedMatter = await prisma.matter.update({
      where: { id },
      data: validation.data, // Only includes fields present in the request body
    });
    res.json(updatedMatter);
  } catch (error) {
    // Handle potential errors like record not found (P2025)
    if ((error as any).code === 'P2025') {
        return res.status(404).json({ error: 'Matter not found' });
    }
    next(error);
  }
});

// DELETE /api/matters/:id - Delete a matter (consider soft delete)
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // !! IMPORTANT: Add permission check !!

    // Option 1: Hard delete
    // await prisma.matter.delete({ where: { id } });

    // Option 2: Soft delete (if schema has `deletedAt DateTime?`)
     await prisma.matter.update({
       where: { id },
       data: { deletedAt: new Date() },
     });

    res.status(204).send(); // No content response
  } catch (error) {
     if ((error as any).code === 'P2025') {
        // If soft deleting, might want to return 204 even if already soft-deleted
        return res.status(404).json({ error: 'Matter not found' });
    }
    next(error);
  }
});


export default router;