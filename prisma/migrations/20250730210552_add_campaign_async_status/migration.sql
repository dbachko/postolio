-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "previewGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "status" SET DEFAULT 'creating';
