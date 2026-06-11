import { z } from "zod";

export const KNOWLEDGE_ENTITY_SUGGESTION_KIND = "knowledge-entity-create";
export const KNOWLEDGE_RELATION_SUGGESTION_KIND = "knowledge-relation-create";

const knowledgeActionSchema = z.enum(["propose", "create"]);
const knowledgeAttributesSchema = z.record(z.string(), z.unknown());

const knowledgeEntityFields = {
  itemId: z.string().cuid(),
  entityType: z.string().min(1).max(120),
  title: z.string().min(1).max(255),
  summary: z.string().max(2000).optional(),
  attributes: knowledgeAttributesSchema.optional(),
  sourceConfidence: z.number().min(0).max(1).optional(),
} as const;

const knowledgeRelationFields = {
  sourceEntityId: z.string().cuid(),
  targetEntityId: z.string().cuid(),
  relationType: z.string().min(1).max(120),
  summary: z.string().max(2000).optional(),
  attributes: knowledgeAttributesSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
} as const;

export const knowledgeEntityMutationSchema = z.object({
  kind: z.literal("entity").default("entity"),
  action: knowledgeActionSchema.default("propose"),
  ...knowledgeEntityFields,
});

export const knowledgeRelationMutationSchema = z.object({
  kind: z.literal("relation"),
  action: knowledgeActionSchema.default("propose"),
  ...knowledgeRelationFields,
});

export type KnowledgeEntityMutationInput = z.infer<
  typeof knowledgeEntityMutationSchema
>;
export type KnowledgeRelationMutationInput = z.infer<
  typeof knowledgeRelationMutationSchema
>;

export function parseKnowledgeMutation(input: unknown) {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    (input as Record<string, unknown>).kind === "relation"
  ) {
    return knowledgeRelationMutationSchema.parse(input);
  }

  return knowledgeEntityMutationSchema.parse(input);
}

export const knowledgeEntitySuggestionPayloadSchema = z.object({
  kind: z.literal(KNOWLEDGE_ENTITY_SUGGESTION_KIND),
  ...knowledgeEntityFields,
});

export const knowledgeRelationSuggestionPayloadSchema = z.object({
  kind: z.literal(KNOWLEDGE_RELATION_SUGGESTION_KIND),
  ...knowledgeRelationFields,
});
