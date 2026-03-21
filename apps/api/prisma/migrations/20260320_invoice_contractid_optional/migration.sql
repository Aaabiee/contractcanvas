-- AlterTable: make Invoice.contractId optional
ALTER TABLE "Invoice" ALTER COLUMN "contractId" DROP NOT NULL;

-- DropForeignKey (will be re-added with SetNull)
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_contractId_fkey";

-- AddForeignKey with ON DELETE SET NULL
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
