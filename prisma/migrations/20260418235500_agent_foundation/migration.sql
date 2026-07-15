-- CreateEnum
CREATE TYPE "AgentProfileStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ModelProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI', 'OPENROUTER', 'OPENAI_COMPAT');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'UNVERIFIED', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "IntegrationProviderType" AS ENUM ('OPENCLAW', 'WHATSAPP', 'WEBHOOK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "IntegrationAuthMode" AS ENUM ('TOKEN', 'HMAC', 'OAUTH_PROXY');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AgentActionKind" AS ENUM ('READ', 'INGEST', 'COMMENT', 'PROPOSE', 'WRITE', 'EXECUTE_EXTERNAL', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "AgentActionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERTED', 'APPROVAL_REQUIRED');

-- CreateEnum
CREATE TYPE "ChangeSetStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'REVERTED');

-- CreateEnum
CREATE TYPE "SuggestionKind" AS ENUM ('INTERNAL_ORGANIZATION', 'EXTERNAL_ACTION');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "KnowledgeEntityStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ItemEntityLinkType" AS ENUM ('SOURCE', 'TAGGED', 'MENTIONED', 'SUMMARIZED', 'CLUSTERED');

-- CreateEnum
CREATE TYPE "WorkspaceCheckpointActorType" AS ENUM ('USER', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CanvasViewType" AS ENUM ('MANUAL', 'ORGANIZER');

-- CreateEnum
CREATE TYPE "AgentJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AgentProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AgentProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxCapabilityRung" INTEGER NOT NULL DEFAULT 3,
    "enabledRungs" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3]::INTEGER[],
    "allowedCanvasIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultModelCredentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "ModelProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT,
    "defaultModel" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "secretFingerprint" TEXT NOT NULL,
    "capabilities" JSONB,
    "dailySpendCap" DOUBLE PRECISION,
    "monthlySpendCap" DOUBLE PRECISION,
    "status" "CredentialStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationAccount" (
    "id" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "providerType" "IntegrationProviderType" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "authMode" "IntegrationAuthMode" NOT NULL,
    "encryptedSecretOrHash" TEXT NOT NULL,
    "secretPrefix" TEXT,
    "secretSuffix" TEXT,
    "replayCursor" JSONB,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "integrationAccountId" TEXT,
    "modelCredentialId" TEXT,
    "kind" "AgentActionKind" NOT NULL,
    "rung" INTEGER NOT NULL,
    "status" "AgentActionStatus" NOT NULL,
    "summary" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeSet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "agentActionId" TEXT,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "status" "ChangeSetStatus" NOT NULL,
    "summary" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),

    CONSTRAINT "ChangeSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRecord" (
    "id" TEXT NOT NULL,
    "changeSetId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reversible" BOOLEAN NOT NULL DEFAULT true,
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentProfileId" TEXT,
    "kind" "SuggestionKind" NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'OPEN',
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "actedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeEntity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" "KnowledgeEntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "attributes" JSONB,
    "sourceConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemEntityLink" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "knowledgeEntityId" TEXT NOT NULL,
    "linkType" "ItemEntityLinkType" NOT NULL DEFAULT 'SOURCE',
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemEntityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemEmbedding" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "vector" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceCheckpoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByActorType" "WorkspaceCheckpointActorType" NOT NULL,
    "createdByActorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "viewType" "CanvasViewType" NOT NULL,
    "name" TEXT,
    "filters" JSONB,
    "layout" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentProfileId" TEXT,
    "jobType" TEXT NOT NULL,
    "status" "AgentJobStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" JSONB,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentProfile_userId_status_idx" ON "AgentProfile"("userId", "status");

-- CreateIndex
CREATE INDEX "AgentProfile_defaultModelCredentialId_idx" ON "AgentProfile"("defaultModelCredentialId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelCredential_userId_secretFingerprint_key" ON "ModelCredential"("userId", "secretFingerprint");

-- CreateIndex
CREATE INDEX "ModelCredential_userId_provider_status_idx" ON "ModelCredential"("userId", "provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationAccount_providerType_externalAccountId_key" ON "IntegrationAccount"("providerType", "externalAccountId");

-- CreateIndex
CREATE INDEX "IntegrationAccount_agentProfileId_status_idx" ON "IntegrationAccount"("agentProfileId", "status");

-- CreateIndex
CREATE INDEX "IntegrationAccount_secretPrefix_secretSuffix_idx" ON "IntegrationAccount"("secretPrefix", "secretSuffix");

-- CreateIndex
CREATE INDEX "AgentAction_userId_createdAt_idx" ON "AgentAction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentAction_agentProfileId_createdAt_idx" ON "AgentAction"("agentProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentAction_requestFingerprint_idx" ON "AgentAction"("requestFingerprint");

-- CreateIndex
CREATE INDEX "ChangeSet_userId_startedAt_idx" ON "ChangeSet"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "ChangeSet_agentActionId_idx" ON "ChangeSet"("agentActionId");

-- CreateIndex
CREATE INDEX "ChangeSet_scopeType_scopeId_idx" ON "ChangeSet"("scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "ChangeRecord_changeSetId_idx" ON "ChangeRecord"("changeSetId");

-- CreateIndex
CREATE INDEX "ChangeRecord_targetType_targetId_idx" ON "ChangeRecord"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Suggestion_userId_status_expiresAt_idx" ON "Suggestion"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "Suggestion_agentProfileId_createdAt_idx" ON "Suggestion"("agentProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeEntity_userId_entityType_idx" ON "KnowledgeEntity"("userId", "entityType");

-- CreateIndex
CREATE INDEX "KnowledgeEntity_userId_title_idx" ON "KnowledgeEntity"("userId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "ItemEntityLink_itemId_knowledgeEntityId_linkType_key" ON "ItemEntityLink"("itemId", "knowledgeEntityId", "linkType");

-- CreateIndex
CREATE INDEX "ItemEntityLink_knowledgeEntityId_idx" ON "ItemEntityLink"("knowledgeEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemEmbedding_itemId_provider_model_key" ON "ItemEmbedding"("itemId", "provider", "model");

-- CreateIndex
CREATE INDEX "ItemEmbedding_provider_model_idx" ON "ItemEmbedding"("provider", "model");

-- CreateIndex
CREATE INDEX "WorkspaceCheckpoint_userId_scopeType_scopeId_createdAt_idx" ON "WorkspaceCheckpoint"("userId", "scopeType", "scopeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasView_userId_canvasId_viewType_key" ON "CanvasView"("userId", "canvasId", "viewType");

-- CreateIndex
CREATE INDEX "CanvasView_canvasId_idx" ON "CanvasView"("canvasId");

-- CreateIndex
CREATE INDEX "AgentJob_status_scheduledAt_idx" ON "AgentJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "AgentJob_agentProfileId_createdAt_idx" ON "AgentJob"("agentProfileId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_defaultModelCredentialId_fkey" FOREIGN KEY ("defaultModelCredentialId") REFERENCES "ModelCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelCredential" ADD CONSTRAINT "ModelCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationAccount" ADD CONSTRAINT "IntegrationAccount_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_integrationAccountId_fkey" FOREIGN KEY ("integrationAccountId") REFERENCES "IntegrationAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_modelCredentialId_fkey" FOREIGN KEY ("modelCredentialId") REFERENCES "ModelCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSet" ADD CONSTRAINT "ChangeSet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSet" ADD CONSTRAINT "ChangeSet_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSet" ADD CONSTRAINT "ChangeSet_agentActionId_fkey" FOREIGN KEY ("agentActionId") REFERENCES "AgentAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRecord" ADD CONSTRAINT "ChangeRecord_changeSetId_fkey" FOREIGN KEY ("changeSetId") REFERENCES "ChangeSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEntity" ADD CONSTRAINT "KnowledgeEntity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemEntityLink" ADD CONSTRAINT "ItemEntityLink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemEntityLink" ADD CONSTRAINT "ItemEntityLink_knowledgeEntityId_fkey" FOREIGN KEY ("knowledgeEntityId") REFERENCES "KnowledgeEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemEmbedding" ADD CONSTRAINT "ItemEmbedding_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CanvasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceCheckpoint" ADD CONSTRAINT "WorkspaceCheckpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasView" ADD CONSTRAINT "CanvasView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasView" ADD CONSTRAINT "CanvasView_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
