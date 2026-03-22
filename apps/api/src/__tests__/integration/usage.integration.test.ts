/**
 * Integration tests for checkStorageLimit in usage.service.ts (lines 49-64).
 * Runs against a real PostgreSQL container — no Prisma mocks.
 */

import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';
import { checkStorageLimit, PLAN_LIMITS } from '../../services/usage.service.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

afterEach(() => cleanDb(db));
afterAll(() => db.$disconnect());

describe('checkStorageLimit (integration)', () => {
  it('passes for STARTER tier when under limit', async () => {
    const app = buildApp();
    const { orgId } = await seedAuth(app);

    // Delete auto-created subscription → falls back to STARTER
    await db.subscription.deleteMany({ where: { organizationId: orgId } });

    // No documents exist, small file → under 1 GiB limit
    await expect(checkStorageLimit(orgId, 1000)).resolves.toBeUndefined();
  });

  it('throws STORAGE_LIMIT_EXCEEDED for STARTER when over limit', async () => {
    const app = buildApp();
    const { orgId, userId } = await seedAuth(app);

    // Delete subscription → STARTER tier
    await db.subscription.deleteMany({ where: { organizationId: orgId } });

    // Create a matter + large document
    const matter = await db.matter.create({
      data: { title: 'Storage Test', organizationId: orgId, ownerId: userId },
    });
    await db.document.create({
      data: {
        organizationId: orgId,
        matterId: matter.id,
        filename: 'big-file.pdf',
        storageKey: 'fake/big.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1_000_000_000, // ~1 GB
        status: 'ACTIVE',
      },
    });

    // Adding 100 MB more should exceed the 1 GiB limit
    try {
      await checkStorageLimit(orgId, 100_000_000);
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.statusCode).toBe(402);
      expect(err.code).toBe('STORAGE_LIMIT_EXCEEDED');
      expect(err.limitBytes).toBe(PLAN_LIMITS.STARTER.storageBytes);
      expect(err.usedBytes).toBe(1_000_000_000);
      expect(err.upgradeUrl).toBe('/settings/billing');
    }
  });

  it('passes when no documents exist (null aggregate)', async () => {
    const app = buildApp();
    const { orgId } = await seedAuth(app);

    await db.subscription.deleteMany({ where: { organizationId: orgId } });

    // No documents → _sum.sizeBytes is null → used = 0
    await expect(checkStorageLimit(orgId, 500_000_000)).resolves.toBeUndefined();
  });

  it('passes for PROFESSIONAL tier when under limit', async () => {
    const app = buildApp();
    const { orgId, userId } = await seedAuth(app);

    // Create a PROFESSIONAL subscription
    await db.subscription.deleteMany({ where: { organizationId: orgId } });
    await db.subscription.create({
      data: {
        organizationId: orgId,
        tier: 'PROFESSIONAL',
        status: 'active',
        stripeSubscriptionId: `sub_storage_${Date.now()}`,
        stripeCustomerId: 'cus_storage_test',
      },
    });

    const matter = await db.matter.create({
      data: { title: 'Pro Storage', organizationId: orgId, ownerId: userId },
    });
    // sizeBytes is INT4 (max ~2.1B), so use multiple smaller documents
    for (let i = 0; i < 3; i++) {
      await db.document.create({
        data: {
          organizationId: orgId,
          matterId: matter.id,
          filename: `medium-${i}.pdf`,
          storageKey: `fake/medium-${i}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1_500_000_000, // 1.5 GB each → 4.5 GB total
          status: 'ACTIVE',
        },
      });
    }

    // 4.5 GB used + 1 GB = 5.5 GB < 10 GB PROFESSIONAL limit
    await expect(checkStorageLimit(orgId, 1_000_000_000)).resolves.toBeUndefined();
  });

  it('throws for PROFESSIONAL tier when over limit', async () => {
    const app = buildApp();
    const { orgId, userId } = await seedAuth(app);

    await db.subscription.deleteMany({ where: { organizationId: orgId } });
    await db.subscription.create({
      data: {
        organizationId: orgId,
        tier: 'PROFESSIONAL',
        status: 'active',
        stripeSubscriptionId: `sub_storage_over_${Date.now()}`,
        stripeCustomerId: 'cus_storage_over',
      },
    });

    const matter = await db.matter.create({
      data: { title: 'Pro Over', organizationId: orgId, ownerId: userId },
    });
    // Create 6 docs × 1.8 GB = 10.8 GB → exceeds 10 GB PROFESSIONAL limit
    for (let i = 0; i < 6; i++) {
      await db.document.create({
        data: {
          organizationId: orgId,
          matterId: matter.id,
          filename: `huge-${i}.pdf`,
          storageKey: `fake/huge-${i}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1_800_000_000, // 1.8 GB each
          status: 'ACTIVE',
        },
      });
    }

    // 10.8 GB used + 1 GB > 10 GB PROFESSIONAL limit
    await expect(checkStorageLimit(orgId, 1_000_000_000)).rejects.toThrow('Storage limit exceeded');
  });

  it('ignores non-ACTIVE documents in aggregate', async () => {
    const app = buildApp();
    const { orgId, userId } = await seedAuth(app);

    await db.subscription.deleteMany({ where: { organizationId: orgId } });

    const matter = await db.matter.create({
      data: { title: 'Inactive Docs', organizationId: orgId, ownerId: userId },
    });

    // Create a large document with non-ACTIVE status
    await db.document.create({
      data: {
        organizationId: orgId,
        matterId: matter.id,
        filename: 'archived.pdf',
        storageKey: 'fake/archived.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2_000_000_000, // 2 GB — would exceed STARTER if counted
        status: 'ARCHIVED',
      },
    });

    // Should pass because only ACTIVE documents count
    await expect(checkStorageLimit(orgId, 500_000_000)).resolves.toBeUndefined();
  });
});
