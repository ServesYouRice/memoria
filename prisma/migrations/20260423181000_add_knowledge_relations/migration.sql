CREATE TYPE "KnowledgeRelationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "KnowledgeRelation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "summary" TEXT,
    "status" "KnowledgeRelationStatus" NOT NULL DEFAULT 'ACTIVE',
    "attributes" JSONB,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeRelation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeRelation_sourceEntityId_targetEntityId_relationType_key" ON "KnowledgeRelation"("sourceEntityId", "targetEntityId", "relationType");
CREATE INDEX "KnowledgeRelation_userId_relationType_idx" ON "KnowledgeRelation"("userId", "relationType");
CREATE INDEX "KnowledgeRelation_sourceEntityId_idx" ON "KnowledgeRelation"("sourceEntityId");
CREATE INDEX "KnowledgeRelation_targetEntityId_idx" ON "KnowledgeRelation"("targetEntityId");

ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_sourceEntityId_fkey" FOREIGN KEY ("sourceEntityId") REFERENCES "KnowledgeEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_targetEntityId_fkey" FOREIGN KEY ("targetEntityId") REFERENCES "KnowledgeEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
