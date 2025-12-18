-- Add template fields to ContentGroup for Template + per-destination editing.

ALTER TABLE "public"."content_groups"
  ADD COLUMN "templateInitialized" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "templateCaption" TEXT,
  ADD COLUMN "templateContentType" TEXT,
  ADD COLUMN "templateShareToFeed" BOOLEAN,
  ADD COLUMN "templateThumbOffset" INTEGER,
  ADD COLUMN "templateFirstComment" TEXT,
  ADD COLUMN "templateAssetIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

