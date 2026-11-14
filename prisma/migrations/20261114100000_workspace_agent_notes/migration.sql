-- IMP-107: the owner's standing notes for AI agents, per workspace, and an
-- activity entry when they change.
ALTER TABLE "Workspace" ADD COLUMN "agentNotes" VARCHAR(2000);
ALTER TYPE "ActivityType" ADD VALUE 'WORKSPACE_AGENT_NOTES_UPDATED';
