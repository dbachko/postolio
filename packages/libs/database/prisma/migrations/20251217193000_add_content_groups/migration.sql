-- Add ContentGroup model to support multi-destination posts.

-- CreateTable
CREATE TABLE "public"."content_groups" (
  "id" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "content_groups_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."content_groups"
  ADD CONSTRAINT "content_groups_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "public"."brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "content_groups_brandId_idx"
  ON "public"."content_groups"("brandId");

-- Add Content.contentGroupId + foreign key to ContentGroup
ALTER TABLE "public"."content" ADD COLUMN "contentGroupId" TEXT;

ALTER TABLE "public"."content"
  ADD CONSTRAINT "content_contentGroupId_fkey"
  FOREIGN KEY ("contentGroupId") REFERENCES "public"."content_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "content_contentGroupId_idx"
  ON "public"."content"("contentGroupId");

