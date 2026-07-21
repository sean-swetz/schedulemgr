-- AlterEnum
ALTER TYPE "NotificationEvent" ADD VALUE 'BROADCAST';

-- CreateTable
CREATE TABLE "BroadcastTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastTemplate_pkey" PRIMARY KEY ("id")
);
