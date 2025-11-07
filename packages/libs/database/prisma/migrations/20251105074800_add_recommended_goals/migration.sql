-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "recommendedGoals" JSONB,
ADD COLUMN     "recommendedGoalsGeneratedAt" TIMESTAMP(3);
