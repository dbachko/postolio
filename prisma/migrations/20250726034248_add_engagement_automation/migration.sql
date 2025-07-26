-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "engagementActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "engagementRules" JSONB;
