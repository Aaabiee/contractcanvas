import prisma from '../prisma.js';

export const PLAN_LIMITS = {
  STARTER:      { matters: 5,   members: 3,   storageBytes: 1_073_741_824  },
  PROFESSIONAL: { matters: 50,  members: 15,  storageBytes: 10_737_418_240 },
  ENTERPRISE:   { matters: Infinity, members: Infinity, storageBytes: 107_374_182_400 },
} as const;

export async function getOrgTier(organizationId: string): Promise<keyof typeof PLAN_LIMITS> {
  const sub = await prisma.subscription.findFirst({
    where:   { organizationId, status: { in: ['active', 'trialing'] } },
    orderBy: { createdAt: 'desc' },
  });
  return (sub?.tier ?? 'STARTER') as keyof typeof PLAN_LIMITS;
}

export async function checkMatterLimit(organizationId: string): Promise<void> {
  const tier   = await getOrgTier(organizationId);
  const limit  = PLAN_LIMITS[tier].matters;
  if (limit === Infinity) return;
  const count  = await prisma.matter.count({ where: { organizationId, deletedAt: null } });
  if (count >= limit) {
    const err: any = new Error(`Matter limit (${limit}) reached for ${tier} plan`);
    err.statusCode  = 402;
    err.code        = 'LIMIT_EXCEEDED';
    err.limit       = limit;
    err.current     = count;
    err.upgradeUrl  = '/settings/billing';
    throw err;
  }
}

export async function checkMemberLimit(organizationId: string): Promise<void> {
  const tier   = await getOrgTier(organizationId);
  const limit  = PLAN_LIMITS[tier].members;
  if (limit === Infinity) return;
  const count  = await prisma.organizationMember.count({ where: { organizationId } });
  if (count >= limit) {
    const err: any = new Error(`Member limit (${limit}) reached for ${tier} plan`);
    err.statusCode  = 402;
    err.code        = 'LIMIT_EXCEEDED';
    err.limit       = limit;
    err.current     = count;
    err.upgradeUrl  = '/settings/billing';
    throw err;
  }
}

export async function checkStorageLimit(organizationId: string, newFileSizeBytes: number): Promise<void> {
  const tier   = await getOrgTier(organizationId);
  const limit  = PLAN_LIMITS[tier].storageBytes;
  if (limit === Infinity) return;
  const agg    = await prisma.document.aggregate({ where: { organizationId, status: 'ACTIVE' }, _sum: { sizeBytes: true } });
  const used   = agg._sum.sizeBytes ?? 0;
  if (used + newFileSizeBytes > limit) {
    const err: any = new Error(`Storage limit exceeded for ${tier} plan`);
    err.statusCode  = 402;
    err.code        = 'STORAGE_LIMIT_EXCEEDED';
    err.limitBytes  = limit;
    err.usedBytes   = used;
    err.upgradeUrl  = '/settings/billing';
    throw err;
  }
}
