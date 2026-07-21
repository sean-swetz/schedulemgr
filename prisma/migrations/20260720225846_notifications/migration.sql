-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('CLASS_OPENED', 'CLASS_CLAIMED', 'REMINDER_24H');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "event" "NotificationEvent" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("event")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "userId" TEXT,
    "toAddress" TEXT,
    "subject" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "fromName" TEXT NOT NULL DEFAULT 'CFP Coverage',
    "fromEmail" TEXT NOT NULL DEFAULT 'onboarding@resend.dev',
    "replyTo" TEXT,
    "gymName" TEXT NOT NULL DEFAULT 'CrossFit Prosperity',
    "gymAddress" TEXT NOT NULL DEFAULT 'Norwood, MA',
    "classMinutes" INTEGER NOT NULL DEFAULT 75,
    "ccAdminsOnClaim" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_event_idx" ON "NotificationLog"("event");
