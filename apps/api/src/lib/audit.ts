import prisma from '../prisma.js';

export interface AuditEntry {
  organizationId: string;
  actorId?:       string;
  entity:         string;
  entityId:       string;
  action:         string;
  before?:        object;
  after?:         object;
  ip?:            string;
  userAgent?:     string;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({ data: entry });
}
