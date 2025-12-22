-- Add publishing queues (per social account), lane-aware slots, and queued items.

CREATE TABLE "public"."publishing_queues" (
  "id" TEXT NOT NULL,
  "socialAccountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "publishing_queues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."publishing_queue_slots" (
  "id" TEXT NOT NULL,
  "queueId" TEXT NOT NULL,
  "socialAccountId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "localTime" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "laneKey" TEXT NOT NULL DEFAULT 'post',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "publishing_queue_slots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."publishing_queue_items" (
  "id" TEXT NOT NULL,
  "queueId" TEXT NOT NULL,
  "contentId" TEXT NOT NULL,
  "laneKey" TEXT NOT NULL DEFAULT 'post',
  "position" INTEGER NOT NULL,
  "notBefore" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "publishing_queue_items_pkey" PRIMARY KEY ("id")
);

-- Constraints

CREATE UNIQUE INDEX "publishing_queues_socialAccountId_name_key"
  ON "public"."publishing_queues"("socialAccountId", "name");

CREATE UNIQUE INDEX "publishing_queue_slots_socialAccountId_dayOfWeek_localTime_key"
  ON "public"."publishing_queue_slots"("socialAccountId", "dayOfWeek", "localTime");

CREATE UNIQUE INDEX "publishing_queue_items_contentId_key"
  ON "public"."publishing_queue_items"("contentId");

-- Indexes

CREATE INDEX "publishing_queues_socialAccountId_idx"
  ON "public"."publishing_queues"("socialAccountId");

CREATE INDEX "publishing_queue_slots_queueId_idx"
  ON "public"."publishing_queue_slots"("queueId");

CREATE INDEX "publishing_queue_items_queueId_idx"
  ON "public"."publishing_queue_items"("queueId");

CREATE INDEX "publishing_queue_items_queueId_laneKey_position_idx"
  ON "public"."publishing_queue_items"("queueId", "laneKey", "position");

-- Foreign keys

ALTER TABLE "public"."publishing_queues"
  ADD CONSTRAINT "publishing_queues_socialAccountId_fkey"
  FOREIGN KEY ("socialAccountId") REFERENCES "public"."social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."publishing_queue_slots"
  ADD CONSTRAINT "publishing_queue_slots_queueId_fkey"
  FOREIGN KEY ("queueId") REFERENCES "public"."publishing_queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."publishing_queue_items"
  ADD CONSTRAINT "publishing_queue_items_queueId_fkey"
  FOREIGN KEY ("queueId") REFERENCES "public"."publishing_queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."publishing_queue_items"
  ADD CONSTRAINT "publishing_queue_items_contentId_fkey"
  FOREIGN KEY ("contentId") REFERENCES "public"."content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

