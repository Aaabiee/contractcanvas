// apps/api/src/routes/signatures.ts
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';

export const router = Router();

// --- Zod Schemas ---
const CreateEnvelopeSchema = z.object({
  contractId: z.string().cuid(),
  provider: z.enum(['docusign', 'hellosign']), // Example providers
  recipients: z.array(z.object({ // Basic recipient structure
    email: z.string().email(),
    name: z.string(),
    role: z.string(), // e.g., 'signer', 'cc'
  })).min(1),
  // TODO: Add organizationId from context
  organizationId: z.string().cuid(),
});

// --- Routes ---

// POST /api/signatures (Create and potentially send an envelope)
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        // TODO: Add auth/org checks
        const validation = CreateEnvelopeSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
        }
        const data = validation.data;
        // TODO: Verify contractId belongs to user's org

        // --- Integration Logic Placeholder ---
        // 1. Call DocuSign/HelloSign SDK to create the envelope draft
        // const providerResponse = await esignService.createEnvelope(data);
        const fakeProviderResponse = { id: `provider_${Date.now()}` }; // Replace with real SDK call
        // --- End Placeholder ---

        // 2. Save envelope record in our DB
        const newEnvelope = await prisma.signatureEnvelope.create({
            data: {
                organizationId: data.organizationId, // Replace with req.user.organizationId
                contractId: data.contractId,
                provider: data.provider,
                providerId: fakeProviderResponse.id, // ID from the e-sign provider
                status: 'CREATED', // Initial status
                recipients: data.recipients as any, // Store recipient info (as Json)
            }
        });

        // 3. Optionally, immediately send the envelope via SDK
        // await esignService.sendEnvelope(newEnvelope.providerId);
        // await prisma.signatureEnvelope.update({ where: { id: newEnvelope.id }, data: { status: 'SENT' } });

        res.status(201).json(newEnvelope);
    } catch (error) {
        next(error);
    }
});

// GET /api/signatures (List envelopes, likely filtered by contract)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        // TODO: Add auth/org checks
        const { contractId } = req.query; // Expect ?contractId=...
        if (!contractId || typeof contractId !== 'string') {
            return res.status(400).json({ error: 'contractId query parameter is required' });
        }
        // TODO: Verify contractId belongs to user's org

        const envelopes = await prisma.signatureEnvelope.findMany({
            where: { contractId /*, organizationId: req.user.organizationId */ },
            orderBy: { createdAt: 'desc' },
        });
        res.json(envelopes);
    } catch (error) {
        next(error);
    }
});

// GET /api/signatures/:id (Get envelope status - potentially sync with provider)
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        // TODO: Add auth/org checks
        const { id } = req.params;
        const envelope = await prisma.signatureEnvelope.findUnique({
            where: { id /*, organizationId: req.user.organizationId */ }
        });
        if (!envelope) {
            return res.status(404).json({ error: 'Signature envelope not found' });
        }

        // Optional: Sync status with e-sign provider API before returning
        // const currentStatus = await esignService.getEnvelopeStatus(envelope.providerId);
        // if (currentStatus !== envelope.status) { /* Update DB */ }

        res.json(envelope);
    } catch (error) {
        next(error);
    }
});

// POST /api/webhooks/esign (Handle callbacks from provider) - NEEDS SEPARATE ROUTE in server.ts w/o JSON parsing
// This route should live in its own file or be mounted carefully in server.ts
// BEFORE express.json() is applied globally, and potentially use a raw body parser.
// Example structure (needs refinement):
// router.post('/webhooks/esign', express.raw({ type: 'application/json' or provider specific }), async (req, res) => {
//     try {
//         const signature = req.headers['x-provider-signature']; // Varies by provider
//         const payload = req.body; // Raw payload
//         // 1. Verify signature using provider webhook secret
//         // 2. Parse payload
//         // 3. Find corresponding SignatureEnvelope by providerId
//         // 4. Update status in DB (SIGNED, COMPLETED, DECLINED, etc.)
//         // 5. Potentially update related Contract status
//         res.status(200).send('OK');
//     } catch (error) {
//         // Handle verification errors, etc.
//         res.status(400).send('Webhook processing failed');
//     }
// });


export default router;