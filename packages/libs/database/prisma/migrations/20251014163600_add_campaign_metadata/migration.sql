-- Add structured campaign metadata columns
-- Adds: contentPillars JSONB, urgencyTactics JSONB, seasonalContext JSONB

ALTER TABLE "campaigns"
  ADD COLUMN "contentPillars" JSONB,
  ADD COLUMN "urgencyTactics" JSONB,
  ADD COLUMN "seasonalContext" JSONB;

