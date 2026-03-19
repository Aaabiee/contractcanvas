/**
 * Prisma seed script — run with: npx tsx prisma/seed.ts
 * Populates the database with realistic sample data for development.
 */
import { PrismaClient, Role, OrgRole, MatterStatus, ContractStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ---- Organization ----
  const org = await prisma.organization.upsert({
    where:  { slug: 'acme-law' },
    update: {},
    create: { name: 'Acme Law Firm', slug: 'acme-law' },
  });
  console.log(`✓ Organization: ${org.name} (${org.id})`);

  // ---- Users ----
  const passwordHash = await bcrypt.hash('Password123!', 12);

  const alice = await prisma.user.upsert({
    where:  { email: 'alice@acme-law.com' },
    update: {},
    create: {
      email: 'alice@acme-law.com', passwordHash,
      firstName: 'Alice', lastName: 'Smith', name: 'Alice Smith',
      role: Role.ADMIN,
    },
  });

  const bob = await prisma.user.upsert({
    where:  { email: 'bob@acme-law.com' },
    update: {},
    create: {
      email: 'bob@acme-law.com', passwordHash,
      firstName: 'Bob', lastName: 'Jones', name: 'Bob Jones',
      role: Role.LAWYER,
    },
  });

  const carol = await prisma.user.upsert({
    where:  { email: 'carol@client.com' },
    update: {},
    create: {
      email: 'carol@client.com', passwordHash,
      firstName: 'Carol', lastName: 'White', name: 'Carol White',
      role: Role.CLIENT,
    },
  });
  console.log(`✓ Users: alice, bob, carol`);

  // ---- Memberships ----
  await prisma.organizationMember.upsert({
    where:  { organizationId_userId: { organizationId: org.id, userId: alice.id } },
    update: {},
    create: { organizationId: org.id, userId: alice.id, role: OrgRole.OWNER },
  });
  await prisma.organizationMember.upsert({
    where:  { organizationId_userId: { organizationId: org.id, userId: bob.id } },
    update: {},
    create: { organizationId: org.id, userId: bob.id, role: OrgRole.ADMIN },
  });
  await prisma.organizationMember.upsert({
    where:  { organizationId_userId: { organizationId: org.id, userId: carol.id } },
    update: {},
    create: { organizationId: org.id, userId: carol.id, role: OrgRole.MEMBER },
  });
  console.log(`✓ Memberships created`);

  // ---- Matters ----
  const matter1 = await prisma.matter.create({
    data: {
      organizationId: org.id,
      ownerId:        alice.id,
      title:          'Acme Corp — MSA Negotiation',
      description:    'Master Service Agreement for 2025 consulting engagement.',
      status:         MatterStatus.OPEN,
    },
  });

  const matter2 = await prisma.matter.create({
    data: {
      organizationId: org.id,
      ownerId:        bob.id,
      title:          'NDA — Project Phoenix',
      description:    'Non-disclosure agreement for confidential project work.',
      status:         MatterStatus.OPEN,
    },
  });
  console.log(`✓ Matters: ${matter1.title}, ${matter2.title}`);

  // ---- Contracts ----
  const contract1 = await prisma.contract.create({
    data: {
      organizationId: org.id,
      matterId:       matter1.id,
      title:          'MSA v1 — Acme Corp',
      status:         ContractStatus.NEGOTIATION,
      valueCents:     5_000_00,
      currency:       'usd',
    },
  });

  const contract2 = await prisma.contract.create({
    data: {
      organizationId: org.id,
      matterId:       matter2.id,
      title:          'NDA — Project Phoenix',
      status:         ContractStatus.DRAFT,
      valueCents:     null,
      currency:       'usd',
    },
  });
  console.log(`✓ Contracts: ${contract1.title}, ${contract2.title}`);

  // ---- Tasks ----
  await prisma.task.createMany({
    data: [
      {
        organizationId: org.id,
        matterId:       matter1.id,
        title:          'Review indemnification clause',
        assigneeId:     bob.id,
        dueAt:          new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // +3 days
      },
      {
        organizationId: org.id,
        matterId:       matter1.id,
        title:          'Send revised MSA to client',
        assigneeId:     alice.id,
        dueAt:          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // +7 days
      },
      {
        organizationId: org.id,
        matterId:       matter2.id,
        title:          'Get NDA signed by all parties',
        assigneeId:     bob.id,
        dueAt:          new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // +2 days
      },
    ],
    skipDuplicates: true,
  });
  console.log(`✓ Tasks seeded`);

  // ---- Clauses ----
  await prisma.clause.createMany({
    data: [
      {
        organizationId: org.id,
        title:          'Standard Indemnification',
        bodyMd:         '**Indemnification.** Each party agrees to indemnify and hold harmless the other party from and against any claims, damages, losses, or expenses arising out of the indemnifying party\'s gross negligence or willful misconduct.',
        tags:           ['indemnification', 'liability'],
        isPublic:       false,
      },
      {
        organizationId: org.id,
        title:          'Governing Law — Delaware',
        bodyMd:         '**Governing Law.** This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict of laws provisions.',
        tags:           ['governing-law', 'delaware'],
        isPublic:       false,
      },
      {
        organizationId: null,
        title:          'Standard Confidentiality (Public)',
        bodyMd:         '**Confidentiality.** The receiving party agrees to keep confidential all non-public information disclosed by the disclosing party and to use such information solely for the purpose of the Agreement.',
        tags:           ['confidentiality', 'nda'],
        isPublic:       true,
      },
    ],
    skipDuplicates: true,
  });
  console.log(`✓ Clauses seeded`);

  // ---- Notifications ----
  await prisma.notification.createMany({
    data: [
      {
        userId:         alice.id,
        organizationId: org.id,
        type:           'SYSTEM',
        title:          'Welcome to ContractCanvas!',
        body:           'Your organization Acme Law Firm is ready. Start by creating a matter.',
      },
      {
        userId:         bob.id,
        organizationId: org.id,
        type:           'REMINDER',
        title:          'Task due soon: Get NDA signed',
        body:           'You have a task due in 2 days on the NDA — Project Phoenix matter.',
      },
    ],
    skipDuplicates: true,
  });
  console.log(`✓ Notifications seeded`);

  console.log('\n✅ Seeding complete!');
  console.log('   Login: alice@acme-law.com / Password123!');
  console.log('   Login: bob@acme-law.com   / Password123!');
  console.log('   Login: carol@client.com   / Password123!');
}

main()
  .catch(e => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
