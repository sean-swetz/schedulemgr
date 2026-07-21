-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEvent" ADD VALUE 'WEEKLY_DIGEST';
ALTER TYPE "NotificationEvent" ADD VALUE 'UNCOVERED_ESCALATION';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "digestDayOfWeek" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "digestHour" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "escalationHours" INTEGER NOT NULL DEFAULT 12;
