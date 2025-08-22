-- AlterTable: Add OAuth and Two-Factor Authentication fields to users table
ALTER TABLE "users" 
ADD COLUMN "googleid" TEXT,
ADD COLUMN "facebookid" TEXT,
ADD COLUMN "profilepicture" TEXT,
ADD COLUMN "emailverified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "twofactorenabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "twofactormethod" TEXT,
ADD COLUMN "twofactorsecret" TEXT,
ADD COLUMN "twofactorbackupcodes" JSONB,
ADD COLUMN "twofactorphonenumber" TEXT;

-- CreateIndex: Unique indexes for OAuth provider IDs
CREATE UNIQUE INDEX "users_googleid_key" ON "users"("googleid");
CREATE UNIQUE INDEX "users_facebookid_key" ON "users"("facebookid");

-- CreateTable: refresh_tokens for JWT refresh token rotation
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userid" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "isrevoked" BOOLEAN NOT NULL DEFAULT false,
    "ipaddress" TEXT,
    "useragent" TEXT,
    "expiresat" TIMESTAMP(3) NOT NULL,
    "createdat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedat" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique index on refresh token
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- AddForeignKey: refresh_tokens to users relationship
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userid_fkey" FOREIGN KEY ("userid") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- CreateTable: audit_logs for security auditing
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userid" TEXT,
    "email" TEXT,
    "eventtype" TEXT NOT NULL,
    "ipaddress" TEXT,
    "useragent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errormessage" TEXT,
    "createdat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Indexes for audit_logs performance
CREATE INDEX "audit_logs_userid_idx" ON "audit_logs"("userid");
CREATE INDEX "audit_logs_email_idx" ON "audit_logs"("email");
CREATE INDEX "audit_logs_eventtype_idx" ON "audit_logs"("eventtype");
CREATE INDEX "audit_logs_createdat_idx" ON "audit_logs"("createdat");