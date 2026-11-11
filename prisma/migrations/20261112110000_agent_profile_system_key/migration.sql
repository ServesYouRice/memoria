-- A server-set marker for built-in agent profiles, so the organizer is found
-- by it and never by its display name. NULL for user-created profiles; the
-- unique index allows any number of NULLs per user.
ALTER TABLE "AgentProfile" ADD COLUMN "systemKey" TEXT;

-- Backfill. Until now the sorter used the oldest profile named
-- 'Memoria organizer' of each user. Mark exactly that profile, so its history,
-- canvas scope and a user's choice to disable it carry over, but only when
-- nothing external is connected to it: a profile with an integration account
-- or OAuth grant is a user's integration that merely shares the name, and it
-- stays unmarked (the next sort creates a separate organizer).
UPDATE "AgentProfile" p
SET "systemKey" = 'organizer'
WHERE p."id" IN (
  SELECT DISTINCT ON (c."userId") c."id"
  FROM "AgentProfile" c
  WHERE c."name" = 'Memoria organizer'
  ORDER BY c."userId", c."createdAt" ASC, c."id" ASC
)
  AND NOT EXISTS (
    SELECT 1 FROM "IntegrationAccount" a WHERE a."agentProfileId" = p."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "OAuthAuthorizationCode" o WHERE o."agentProfileId" = p."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "OAuthToken" t WHERE t."agentProfileId" = p."id"
  );

CREATE UNIQUE INDEX "AgentProfile_userId_systemKey_key" ON "AgentProfile"("userId", "systemKey");
