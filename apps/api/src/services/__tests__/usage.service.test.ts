import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockPrisma = vi.hoisted(() => ({
  subscription: {
    findFirst: vi.fn(),
  },
  matter: {
    count: vi.fn(),
  },
  organizationMember: {
    count: vi.fn(),
  },
  document: {
    aggregate: vi.fn(),
  },
}));

vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

import {
  getOrgTier,
  checkMatterLimit,
  checkMemberLimit,
  checkStorageLimit,
  PLAN_LIMITS,
} from '../usage.service.js';

describe('usage.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* ---- PLAN_LIMITS constants ------------------------------------- */

  describe('PLAN_LIMITS', () => {
    it('defines STARTER with 5 matters, 3 members, 1 GiB storage', () => {
      expect(PLAN_LIMITS.STARTER.matters).toBe(5);
      expect(PLAN_LIMITS.STARTER.members).toBe(3);
      expect(PLAN_LIMITS.STARTER.storageBytes).toBe(1_073_741_824);
    });

    it('defines PROFESSIONAL with 50 matters, 15 members, 10 GiB storage', () => {
      expect(PLAN_LIMITS.PROFESSIONAL.matters).toBe(50);
      expect(PLAN_LIMITS.PROFESSIONAL.members).toBe(15);
      expect(PLAN_LIMITS.PROFESSIONAL.storageBytes).toBe(10_737_418_240);
    });

    it('defines ENTERPRISE with Infinity limits', () => {
      expect(PLAN_LIMITS.ENTERPRISE.matters).toBe(Infinity);
      expect(PLAN_LIMITS.ENTERPRISE.members).toBe(Infinity);
    });
  });

  /* ---- getOrgTier ------------------------------------------------ */

  describe('getOrgTier', () => {
    it('returns STARTER when no subscription exists', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      const tier = await getOrgTier('org-1');

      expect(tier).toBe('STARTER');
      expect(mockPrisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', status: { in: ['active', 'trialing'] } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns the subscription tier when an active subscription exists', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({
        tier: 'PROFESSIONAL',
        status: 'active',
      });

      const tier = await getOrgTier('org-1');

      expect(tier).toBe('PROFESSIONAL');
    });

    it('returns ENTERPRISE tier for enterprise subscriptions', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({
        tier: 'ENTERPRISE',
        status: 'active',
      });

      const tier = await getOrgTier('org-1');

      expect(tier).toBe('ENTERPRISE');
    });
  });

  /* ---- checkMatterLimit ------------------------------------------ */

  describe('checkMatterLimit', () => {
    it('is a no-op for ENTERPRISE tier', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({ tier: 'ENTERPRISE' });

      await expect(checkMatterLimit('org-1')).resolves.toBeUndefined();
      expect(mockPrisma.matter.count).not.toHaveBeenCalled();
    });

    it('passes when count is below the STARTER limit', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null); // STARTER
      mockPrisma.matter.count.mockResolvedValue(3);

      await expect(checkMatterLimit('org-1')).resolves.toBeUndefined();
    });

    it('throws LIMIT_EXCEEDED at the STARTER limit (5)', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null); // STARTER
      mockPrisma.matter.count.mockResolvedValue(5);

      try {
        await checkMatterLimit('org-1');
        expect.unreachable('should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('Matter limit');
        expect(err.statusCode).toBe(402);
        expect(err.code).toBe('LIMIT_EXCEEDED');
        expect(err.limit).toBe(5);
        expect(err.current).toBe(5);
        expect(err.upgradeUrl).toBe('/settings/billing');
      }
    });

    it('throws at PROFESSIONAL limit (50)', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({ tier: 'PROFESSIONAL' });
      mockPrisma.matter.count.mockResolvedValue(50);

      await expect(checkMatterLimit('org-1')).rejects.toThrow('Matter limit');
    });

    it('passes when count is below PROFESSIONAL limit', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({ tier: 'PROFESSIONAL' });
      mockPrisma.matter.count.mockResolvedValue(49);

      await expect(checkMatterLimit('org-1')).resolves.toBeUndefined();
    });
  });

  /* ---- checkMemberLimit ------------------------------------------ */

  describe('checkMemberLimit', () => {
    it('is a no-op for ENTERPRISE tier', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({ tier: 'ENTERPRISE' });

      await expect(checkMemberLimit('org-1')).resolves.toBeUndefined();
      expect(mockPrisma.organizationMember.count).not.toHaveBeenCalled();
    });

    it('passes when count is below the STARTER limit', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null); // STARTER
      mockPrisma.organizationMember.count.mockResolvedValue(2);

      await expect(checkMemberLimit('org-1')).resolves.toBeUndefined();
    });

    it('throws LIMIT_EXCEEDED at the STARTER limit (3)', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null); // STARTER
      mockPrisma.organizationMember.count.mockResolvedValue(3);

      try {
        await checkMemberLimit('org-1');
        expect.unreachable('should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('Member limit');
        expect(err.statusCode).toBe(402);
        expect(err.code).toBe('LIMIT_EXCEEDED');
        expect(err.limit).toBe(3);
        expect(err.current).toBe(3);
        expect(err.upgradeUrl).toBe('/settings/billing');
      }
    });

    it('throws at PROFESSIONAL limit (15)', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({ tier: 'PROFESSIONAL' });
      mockPrisma.organizationMember.count.mockResolvedValue(15);

      await expect(checkMemberLimit('org-1')).rejects.toThrow('Member limit');
    });

    it('passes when count is below PROFESSIONAL limit', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({ tier: 'PROFESSIONAL' });
      mockPrisma.organizationMember.count.mockResolvedValue(14);

      await expect(checkMemberLimit('org-1')).resolves.toBeUndefined();
    });
  });

  /* ---- checkStorageLimit ----------------------------------------- */

  describe('checkStorageLimit', () => {
    it('passes for ENTERPRISE tier (large but finite storage limit)', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({ tier: 'ENTERPRISE' });
      mockPrisma.document.aggregate.mockResolvedValue({
        _sum: { sizeBytes: 50_000_000_000 },
      });

      // ENTERPRISE storageBytes is 100 GiB, not Infinity, so aggregate is still called
      await expect(checkStorageLimit('org-1', 5000)).resolves.toBeUndefined();
    });

    it('passes when used + new file is under the STARTER limit', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null); // STARTER
      mockPrisma.document.aggregate.mockResolvedValue({
        _sum: { sizeBytes: 500_000_000 },
      });

      // 500MB used + 100MB new = 600MB < 1GB limit
      await expect(checkStorageLimit('org-1', 100_000_000)).resolves.toBeUndefined();
    });

    it('throws STORAGE_LIMIT_EXCEEDED when exceeding STARTER limit', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null); // STARTER
      mockPrisma.document.aggregate.mockResolvedValue({
        _sum: { sizeBytes: 1_000_000_000 },
      });

      try {
        await checkStorageLimit('org-1', 100_000_000); // 1GB used + 100MB = over 1GB limit
        expect.unreachable('should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('Storage limit exceeded');
        expect(err.statusCode).toBe(402);
        expect(err.code).toBe('STORAGE_LIMIT_EXCEEDED');
        expect(err.limitBytes).toBe(1_073_741_824);
        expect(err.usedBytes).toBe(1_000_000_000);
        expect(err.upgradeUrl).toBe('/settings/billing');
      }
    });

    it('handles null _sum.sizeBytes (no documents)', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null); // STARTER
      mockPrisma.document.aggregate.mockResolvedValue({
        _sum: { sizeBytes: null },
      });

      // 0 used + 100MB = under 1GB limit
      await expect(checkStorageLimit('org-1', 100_000_000)).resolves.toBeUndefined();
    });

    it('throws when new file alone exceeds limit', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null); // STARTER
      mockPrisma.document.aggregate.mockResolvedValue({
        _sum: { sizeBytes: 0 },
      });

      // 0 used + 2GB = over 1GB limit
      await expect(checkStorageLimit('org-1', 2_000_000_000)).rejects.toThrow(
        'Storage limit exceeded',
      );
    });

    it('passes for PROFESSIONAL tier within limits', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({ tier: 'PROFESSIONAL' });
      mockPrisma.document.aggregate.mockResolvedValue({
        _sum: { sizeBytes: 5_000_000_000 },
      });

      // 5GB used + 1GB new = 6GB < 10GB limit
      await expect(checkStorageLimit('org-1', 1_000_000_000)).resolves.toBeUndefined();
    });
  });
});
