-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "accountlockeduntil" TIMESTAMP(3),
ADD COLUMN     "failedloginattempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "brands_userId_idx" ON "public"."brands"("userId");

-- CreateIndex
CREATE INDEX "brands_createdAt_idx" ON "public"."brands"("createdAt");

-- CreateIndex
CREATE INDEX "brands_engagementActive_idx" ON "public"."brands"("engagementActive");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "users_accountlockeduntil_idx" ON "public"."users"("accountlockeduntil");

-- CreateIndex
CREATE INDEX "users_failedloginattempts_idx" ON "public"."users"("failedloginattempts");

-- CreateIndex
CREATE INDEX "users_emailverified_idx" ON "public"."users"("emailverified");
