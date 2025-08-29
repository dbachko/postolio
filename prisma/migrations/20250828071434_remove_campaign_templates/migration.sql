/*
  Warnings:

  - You are about to drop the `campaign_templates` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."campaign_templates" DROP CONSTRAINT "campaign_templates_brandId_fkey";

-- DropForeignKey
ALTER TABLE "public"."campaign_templates" DROP CONSTRAINT "campaign_templates_createdById_fkey";

-- DropTable
DROP TABLE "public"."campaign_templates";
