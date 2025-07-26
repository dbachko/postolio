/*
  Warnings:

  - Added the required column `password` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable - Add password column with default, then remove default
ALTER TABLE "users" ADD COLUMN "password" TEXT NOT NULL DEFAULT '$2b$10$N9qo8uLOickgx2ZMRZoMye.FH.9OVVnF1/eLJcAcJJ8dNxJCzr9.G';

-- Remove default after adding the column
ALTER TABLE "users" ALTER COLUMN "password" DROP DEFAULT;
