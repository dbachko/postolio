-- CreateEnum
CREATE TYPE "TaxonomyType" AS ENUM ('COLLECTION', 'LABEL');

-- Drop legacy folder FK before removing columns/tables
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_folderId_fkey";

-- Drop legacy index on tags
DROP INDEX IF EXISTS "assets_tags_idx";

-- Alter assets table
ALTER TABLE "assets"
  DROP COLUMN IF EXISTS "folderId",
  DROP COLUMN IF EXISTS "tags",
  ADD COLUMN IF NOT EXISTS "collectionId" TEXT;

-- Create taxonomy tables
CREATE TABLE "asset_taxonomy_items" (
  "id" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "type" "TaxonomyType" NOT NULL,
  "parentId" TEXT,
  "sortOrder" INTEGER,
  "name" TEXT NOT NULL,
  "nameNorm" TEXT,
  "color" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "isHidden" BOOLEAN NOT NULL DEFAULT false,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "asset_taxonomy_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_taxonomy_assignments" (
  "assetId" TEXT NOT NULL,
  "taxonomyItemId" TEXT NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "asset_taxonomy_assignments_pkey" PRIMARY KEY ("assetId", "taxonomyItemId")
);

-- Indexes
CREATE INDEX "asset_taxonomy_items_brandId_type_idx" ON "asset_taxonomy_items"("brandId", "type");
CREATE INDEX "asset_taxonomy_items_parentId_idx" ON "asset_taxonomy_items"("parentId");
CREATE INDEX "asset_taxonomy_assignments_taxonomyItemId_assetId_idx" ON "asset_taxonomy_assignments"("taxonomyItemId", "assetId");
CREATE INDEX "assets_brandId_collectionId_archivedAt_createdAt_idx" ON "assets"("brandId", "collectionId", "archivedAt", "createdAt");

-- Partial unique indexes for taxonomy
CREATE UNIQUE INDEX "asset_taxonomy_labels_unique_idx"
  ON "asset_taxonomy_items"("brandId", "type", "nameNorm")
  WHERE "type" = 'LABEL' AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "asset_taxonomy_collections_unique_idx"
  ON "asset_taxonomy_items"("brandId", "type", "parentId", lower("name"))
  WHERE "type" = 'COLLECTION' AND "deletedAt" IS NULL;

-- Foreign keys
ALTER TABLE "assets"
  ADD CONSTRAINT "assets_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "asset_taxonomy_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "asset_taxonomy_items"
  ADD CONSTRAINT "asset_taxonomy_items_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "asset_taxonomy_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "asset_taxonomy_assignments"
  ADD CONSTRAINT "asset_taxonomy_assignments_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_taxonomy_assignments"
  ADD CONSTRAINT "asset_taxonomy_assignments_taxonomyItemId_fkey"
  FOREIGN KEY ("taxonomyItemId") REFERENCES "asset_taxonomy_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity functions + triggers
CREATE OR REPLACE FUNCTION enforce_taxonomy_item_integrity() RETURNS TRIGGER AS $$
DECLARE
  parent_type "TaxonomyType";
  parent_brand TEXT;
BEGIN
  -- Labels cannot have parents
  IF NEW."type" = 'LABEL' AND NEW."parentId" IS NOT NULL THEN
    RAISE EXCEPTION 'Labels cannot have parent collections';
  END IF;

  -- Collections with parent must reference a collection in same brand
  IF NEW."parentId" IS NOT NULL THEN
    SELECT "type", "brandId" INTO parent_type, parent_brand
    FROM "asset_taxonomy_items"
    WHERE "id" = NEW."parentId";

    IF parent_type IS NULL THEN
      RAISE EXCEPTION 'Parent taxonomy item not found';
    END IF;

    IF parent_type <> 'COLLECTION' THEN
      RAISE EXCEPTION 'Parent taxonomy item must be a collection';
    END IF;

    IF parent_brand <> NEW."brandId" THEN
      RAISE EXCEPTION 'Parent taxonomy item must be in same brand';
    END IF;
  END IF;

  -- Prevent cycles
  IF NEW."parentId" IS NOT NULL THEN
    IF NEW."parentId" = NEW."id" THEN
      RAISE EXCEPTION 'Collection cannot be its own parent';
    END IF;

    IF EXISTS (
      WITH RECURSIVE ancestors AS (
        SELECT "id", "parentId" FROM "asset_taxonomy_items" WHERE "id" = NEW."parentId"
        UNION ALL
        SELECT t."id", t."parentId"
        FROM "asset_taxonomy_items" t
        JOIN ancestors a ON t."id" = a."parentId"
      )
      SELECT 1 FROM ancestors WHERE "id" = NEW."id"
    ) THEN
      RAISE EXCEPTION 'Circular collection hierarchy detected';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_taxonomy_items_integrity_trigger
  BEFORE INSERT OR UPDATE ON "asset_taxonomy_items"
  FOR EACH ROW EXECUTE FUNCTION enforce_taxonomy_item_integrity();

CREATE OR REPLACE FUNCTION enforce_asset_collection_integrity() RETURNS TRIGGER AS $$
DECLARE
  collection_type "TaxonomyType";
  collection_brand TEXT;
BEGIN
  IF NEW."collectionId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "type", "brandId" INTO collection_type, collection_brand
  FROM "asset_taxonomy_items"
  WHERE "id" = NEW."collectionId";

  IF collection_type IS NULL THEN
    RAISE EXCEPTION 'Collection not found';
  END IF;

  IF collection_type <> 'COLLECTION' THEN
    RAISE EXCEPTION 'collectionId must reference a collection';
  END IF;

  IF collection_brand <> NEW."brandId" THEN
    RAISE EXCEPTION 'Collection brand mismatch';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assets_collection_integrity_trigger
  BEFORE INSERT OR UPDATE ON "assets"
  FOR EACH ROW EXECUTE FUNCTION enforce_asset_collection_integrity();

CREATE OR REPLACE FUNCTION enforce_label_assignment_integrity() RETURNS TRIGGER AS $$
DECLARE
  label_type "TaxonomyType";
  label_brand TEXT;
  asset_brand TEXT;
BEGIN
  SELECT "type", "brandId" INTO label_type, label_brand
  FROM "asset_taxonomy_items"
  WHERE "id" = NEW."taxonomyItemId";

  IF label_type IS NULL THEN
    RAISE EXCEPTION 'Label not found';
  END IF;

  IF label_type <> 'LABEL' THEN
    RAISE EXCEPTION 'taxonomyItemId must reference a label';
  END IF;

  SELECT "brandId" INTO asset_brand
  FROM "assets"
  WHERE "id" = NEW."assetId";

  IF asset_brand IS NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  IF asset_brand <> label_brand THEN
    RAISE EXCEPTION 'Label and asset must belong to same brand';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_taxonomy_assignments_integrity_trigger
  BEFORE INSERT OR UPDATE ON "asset_taxonomy_assignments"
  FOR EACH ROW EXECUTE FUNCTION enforce_label_assignment_integrity();

-- Drop legacy folders
DROP TABLE IF EXISTS "asset_folders";
DROP TYPE IF EXISTS "FolderType";
