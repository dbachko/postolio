-- CreateTable
CREATE TABLE "snippets" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "snippets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "snippets_brandId_isArchived_idx" ON "snippets"("brandId", "isArchived");

-- CreateIndex
CREATE INDEX "snippets_brandId_tags_idx" ON "snippets"("brandId", "tags");

-- CreateIndex
CREATE INDEX "snippets_brandId_category_idx" ON "snippets"("brandId", "category");

-- CreateIndex
CREATE INDEX "snippets_userId_idx" ON "snippets"("userId");

-- AddForeignKey
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
