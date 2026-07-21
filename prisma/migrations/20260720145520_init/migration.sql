-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'COACH');

-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('SCHEDULED', 'OPEN', 'CLAIMED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'COACH',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushSubscription" JSONB,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "LoginToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateSlot" (
    "id" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "time" TEXT NOT NULL,
    "className" TEXT NOT NULL DEFAULT 'CrossFit',
    "coachId" TEXT NOT NULL,

    CONSTRAINT "TemplateSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassInstance" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "assignedId" TEXT NOT NULL,
    "status" "ClassStatus" NOT NULL DEFAULT 'SCHEDULED',
    "coveredById" TEXT,
    "note" TEXT,
    "remindedAt" TIMESTAMP(3),

    CONSTRAINT "ClassInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "LoginToken_token_key" ON "LoginToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateSlot_dayOfWeek_time_key" ON "TemplateSlot"("dayOfWeek", "time");

-- CreateIndex
CREATE UNIQUE INDEX "ClassInstance_date_time_key" ON "ClassInstance"("date", "time");

-- AddForeignKey
ALTER TABLE "LoginToken" ADD CONSTRAINT "LoginToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateSlot" ADD CONSTRAINT "TemplateSlot_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassInstance" ADD CONSTRAINT "ClassInstance_assignedId_fkey" FOREIGN KEY ("assignedId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassInstance" ADD CONSTRAINT "ClassInstance_coveredById_fkey" FOREIGN KEY ("coveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
