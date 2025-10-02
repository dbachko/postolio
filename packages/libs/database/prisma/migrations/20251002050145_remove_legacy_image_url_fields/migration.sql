/*
  Warnings:

  - You are about to drop the column `cdnImageUrl` on the `content` table. All the data in the column will be lost.
  - You are about to drop the column `imageUrl` on the `content` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."content" DROP COLUMN "cdnImageUrl",
DROP COLUMN "imageUrl";
