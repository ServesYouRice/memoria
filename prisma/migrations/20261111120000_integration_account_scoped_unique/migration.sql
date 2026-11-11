-- Scope integration-account uniqueness to the agent profile, so one tenant's
-- registration cannot block or reveal another tenant's external account id.
DROP INDEX "IntegrationAccount_providerType_externalAccountId_key";

CREATE UNIQUE INDEX "IntegrationAccount_agentProfileId_providerType_externalAcco_key" ON "IntegrationAccount"("agentProfileId", "providerType", "externalAccountId");
