-- Add missing enum values to existing enums
ALTER TYPE "ContentStatus" ADD VALUE 'posted';
ALTER TYPE "ContentStatus" ADD VALUE 'failed';