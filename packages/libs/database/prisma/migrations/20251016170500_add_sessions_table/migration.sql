-- Create sessions table to support account security and device management
CREATE TABLE "public"."sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "device_fingerprint" TEXT,
    "device_name" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "location" JSONB,
    "trusted" BOOLEAN NOT NULL DEFAULT FALSE,
    "trusted_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_refresh_token_hash_key" UNIQUE ("refresh_token_hash")
);

-- Optional FK to users for referential integrity (Prisma model is not relational here)
ALTER TABLE "public"."sessions"
  ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes to match Prisma model annotations and query patterns
CREATE INDEX "sessions_user_id_idx" ON "public"."sessions"("user_id");
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "public"."sessions"("user_id", "revoked_at");
CREATE INDEX "sessions_expires_at_idx" ON "public"."sessions"("expires_at");
CREATE INDEX "sessions_last_activity_at_idx" ON "public"."sessions"("last_activity_at");
CREATE INDEX "sessions_device_fingerprint_idx" ON "public"."sessions"("device_fingerprint");

