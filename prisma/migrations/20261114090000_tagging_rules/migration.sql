-- IMP-106: a person's own tagging rules, sent to the AI with new tags.
ALTER TABLE "User" ADD COLUMN "taggingRules" VARCHAR(1000);
