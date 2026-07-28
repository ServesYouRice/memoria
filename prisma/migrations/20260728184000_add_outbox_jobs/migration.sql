CREATE TYPE "OutboxJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'DEAD');

CREATE TABLE "OutboxJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "status" "OutboxJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutboxJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutboxJob_dedupeKey_key" ON "OutboxJob"("dedupeKey");
CREATE INDEX "OutboxJob_status_nextRunAt_idx" ON "OutboxJob"("status", "nextRunAt");
CREATE INDEX "OutboxJob_status_leaseExpiresAt_idx" ON "OutboxJob"("status", "leaseExpiresAt");
CREATE INDEX "OutboxJob_completedAt_idx" ON "OutboxJob"("completedAt");
